// mqcapture: per-process WASAPI loopback (SP3, D-18). Captures what one process tree (Spotify.exe) renders,
// independent of other apps and of the endpoint volume, into a 16-bit PCM WAV.
//
//   mqcapture --pid <root pid> --out <file.wav> [--rate 44100] [--channels 2] [--seconds N]
//
// Stops on stdin EOF, a "stop" line on stdin, Ctrl+C or --seconds. Status goes to stdout as JSON lines:
//   {"event":"started","rate":44100,"channels":2,"qpc100ns":...}
//   {"event":"level","frames":...,"peak":0.53,"qpc100ns":...}        once a second
//   {"event":"stopped","frames":...,"gapFrames":...,"packets":...}
// Next to the WAV, <file.wav>.qpc.csv lists every packet: first frame index in the WAV, the QPC time of that
// frame in 100 ns units (the same clock as Python's time.perf_counter_ns() / 100), and the WASAPI flags.
// When the stream skips (no packets while the process is silent) the gap is filled with zeros from QPC times,
// so frame index ↔ wall clock stays linear.

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <wrl/implements.h>

#include <algorithm>
#include <atomic>
#include <cstdarg>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::ComPtr;
using Microsoft::WRL::FtmBase;
using Microsoft::WRL::Make;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;

static std::atomic<bool> g_stop{false};

static void emit(const char* fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  vfprintf(stdout, fmt, ap);
  va_end(ap);
  fputc('\n', stdout);
  fflush(stdout);
}

static int fail(const char* what, HRESULT hr) {
  emit("{\"event\":\"error\",\"what\":\"%s\",\"hr\":\"0x%08lx\"}", what, (unsigned long)hr);
  return 2;
}

class ActivationHandler
    : public RuntimeClass<RuntimeClassFlags<ClassicCom>, FtmBase, IActivateAudioInterfaceCompletionHandler> {
 public:
  HANDLE done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HRESULT result = E_FAIL;
  ComPtr<IAudioClient> client;

  STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation* op) override {
    HRESULT hrActivate = E_FAIL;
    ComPtr<IUnknown> unk;
    result = op->GetActivateResult(&hrActivate, &unk);
    if (SUCCEEDED(result)) result = hrActivate;
    if (SUCCEEDED(result)) result = unk.As(&client);
    SetEvent(done);
    return S_OK;
  }
};

// Minimal WAV writer: header patched with sizes on close.
struct Wav {
  FILE* f = nullptr;
  uint64_t frames = 0;
  int channels = 2, rate = 44100;

  bool open(const wchar_t* path, int ch, int sr) {
    channels = ch;
    rate = sr;
    if (_wfopen_s(&f, path, L"wb") != 0 || !f) return false;
    uint8_t header[44] = {};
    fwrite(header, 1, sizeof header, f);
    return true;
  }
  void write(const int16_t* data, uint32_t n) {
    fwrite(data, sizeof(int16_t) * channels, n, f);
    frames += n;
  }
  void silence(uint32_t n) {
    std::vector<int16_t> zeros(size_t(n) * channels, 0);
    write(zeros.data(), n);
  }
  void close() {
    if (!f) return;
    const uint32_t block = 2 * channels;
    const uint64_t bytes64 = frames * block;
    const uint32_t bytes = bytes64 > 0xFFFFFFF0ull ? 0xFFFFFFF0u : uint32_t(bytes64);
    auto u32 = [&](uint32_t v) { fwrite(&v, 4, 1, f); };
    auto u16 = [&](uint16_t v) { fwrite(&v, 2, 1, f); };
    fseek(f, 0, SEEK_SET);
    fwrite("RIFF", 1, 4, f);
    u32(36 + bytes);
    fwrite("WAVEfmt ", 1, 8, f);
    u32(16);
    u16(1);
    u16(uint16_t(channels));
    u32(uint32_t(rate));
    u32(uint32_t(rate) * block);
    u16(uint16_t(block));
    u16(16);
    fwrite("data", 1, 4, f);
    u32(bytes);
    fclose(f);
    f = nullptr;
  }
};

static int64_t qpcNow100ns() {
  LARGE_INTEGER c, fr;
  QueryPerformanceCounter(&c);
  QueryPerformanceFrequency(&fr);
  return int64_t((long double)c.QuadPart * 10000000.0L / (long double)fr.QuadPart);
}

static BOOL WINAPI onCtrl(DWORD) {
  g_stop = true;
  return TRUE;
}

int wmain(int argc, wchar_t** argv) {
  DWORD pid = 0;
  std::wstring out;
  int rate = 44100, channels = 2;
  double seconds = 0;
  for (int i = 1; i < argc; i++) {
    std::wstring a = argv[i];
    auto next = [&]() -> const wchar_t* { return i + 1 < argc ? argv[++i] : L""; };
    if (a == L"--pid") pid = wcstoul(next(), nullptr, 10);
    else if (a == L"--out") out = next();
    else if (a == L"--rate") rate = _wtoi(next());
    else if (a == L"--channels") channels = _wtoi(next());
    else if (a == L"--seconds") seconds = _wtof(next());
  }
  if (!pid || out.empty() || rate < 8000 || channels < 1 || channels > 2) {
    fprintf(stderr, "usage: mqcapture --pid <pid> --out <file.wav> [--rate 44100] [--channels 2] [--seconds N]\n");
    return 1;
  }

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) return fail("CoInitializeEx", hr);
  SetConsoleCtrlHandler(onCtrl, TRUE);

  // Activate an IAudioClient on the process-loopback virtual device for the whole process tree.
  AUDIOCLIENT_ACTIVATION_PARAMS params = {};
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  params.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
  PROPVARIANT pv = {};
  pv.vt = VT_BLOB;
  pv.blob.cbSize = sizeof params;
  pv.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

  auto handler = Make<ActivationHandler>();
  ComPtr<IActivateAudioInterfaceAsyncOperation> op;
  hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &pv, handler.Get(), &op);
  if (FAILED(hr)) return fail("ActivateAudioInterfaceAsync", hr);
  if (WaitForSingleObject(handler->done, 5000) != WAIT_OBJECT_0) return fail("activate timeout", E_FAIL);
  if (FAILED(handler->result)) return fail("activate", handler->result);
  ComPtr<IAudioClient> client = handler->client;

  // The process-loopback client has no mix format; we choose one and let the engine convert.
  WAVEFORMATEX fmt = {};
  fmt.wFormatTag = WAVE_FORMAT_PCM;
  fmt.nChannels = WORD(channels);
  fmt.nSamplesPerSec = DWORD(rate);
  fmt.wBitsPerSample = 16;
  fmt.nBlockAlign = WORD(fmt.nChannels * fmt.wBitsPerSample / 8);
  fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;

  HANDLE ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                          AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                              AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                          2000000 /* 200 ms */, 0, &fmt, nullptr);
  if (FAILED(hr)) return fail("Initialize", hr);
  if (FAILED(hr = client->SetEventHandle(ready))) return fail("SetEventHandle", hr);
  ComPtr<IAudioCaptureClient> capture;
  if (FAILED(hr = client->GetService(IID_PPV_ARGS(&capture)))) return fail("GetService", hr);

  Wav wav;
  if (!wav.open(out.c_str(), channels, rate)) return fail("open wav", E_ACCESSDENIED);
  FILE* timing = nullptr;
  if (_wfopen_s(&timing, (out + L".qpc.csv").c_str(), L"w") != 0 || !timing) return fail("open timing", E_ACCESSDENIED);
  fprintf(timing, "frame,qpc100ns,frames,flags\n");

  // Stop when stdin closes or says "stop" (the Python watcher owns our lifetime).
  std::thread([] {
    char line[64];
    while (fgets(line, sizeof line, stdin)) {
      if (strncmp(line, "stop", 4) == 0) break;
    }
    g_stop = true;
  }).detach();

  if (FAILED(hr = client->Start())) return fail("Start", hr);
  const int64_t t0 = qpcNow100ns();
  emit("{\"event\":\"started\",\"pid\":%lu,\"rate\":%d,\"channels\":%d,\"qpc100ns\":%lld}", pid, rate, channels, t0);

  const double hnsPerFrame = 1e7 / rate;
  int64_t nextQpc = -1;  // expected QPC of the next packet's first frame
  uint64_t gapFrames = 0, packets = 0;
  float peak = 0;
  int64_t lastLevel = t0;

  while (!g_stop) {
    if (seconds > 0 && double(qpcNow100ns() - t0) / 1e7 >= seconds) break;
    WaitForSingleObject(ready, 100);
    UINT32 n = 0;
    while (SUCCEEDED(capture->GetNextPacketSize(&n)) && n > 0) {
      BYTE* data = nullptr;
      DWORD flags = 0;
      UINT64 devPos = 0, qpc = 0;
      if (FAILED(hr = capture->GetBuffer(&data, &n, &flags, &devPos, &qpc))) return fail("GetBuffer", hr);
      // Re-anchor on every packet so audio-clock vs QPC drift never accumulates into fake gaps.
      if (nextQpc >= 0) {
        const int64_t late = int64_t(qpc) - nextQpc;
        if (late > int64_t(0.02 * 1e7)) {  // > 20 ms with no packets: the process was silent
          const uint32_t fill = uint32_t(std::llround(late / hnsPerFrame));
          wav.silence(fill);
          gapFrames += fill;
        }
      }
      fprintf(timing, "%llu,%llu,%u,%lu\n", (unsigned long long)wav.frames, (unsigned long long)qpc, n, flags);
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
        wav.silence(n);
      } else {
        const int16_t* s = reinterpret_cast<const int16_t*>(data);
        for (UINT32 i = 0; i < n * UINT32(channels); i++) peak = std::max(peak, std::fabs(s[i] / 32768.0f));
        wav.write(s, n);
      }
      nextQpc = int64_t(qpc) + int64_t(std::llround(n * hnsPerFrame));
      packets++;
      capture->ReleaseBuffer(n);
    }
    const int64_t now = qpcNow100ns();
    if (now - lastLevel >= 10000000) {
      emit("{\"event\":\"level\",\"frames\":%llu,\"peak\":%.4f,\"qpc100ns\":%lld}", (unsigned long long)wav.frames, peak, now);
      peak = 0;
      lastLevel = now;
    }
  }

  client->Stop();
  wav.close();
  fclose(timing);
  emit("{\"event\":\"stopped\",\"frames\":%llu,\"gapFrames\":%llu,\"packets\":%llu}", (unsigned long long)wav.frames,
       (unsigned long long)gapFrames, (unsigned long long)packets);
  CoUninitialize();
  return 0;
}
