// The instrument switch on both Stand screens (D-05, D-08): Concert (piano) or the written pitch for E♭ alto or
// B♭ tenor sax. Changes chords, keys, scales and the keyboard at once; the same setting as Settings → Instrument.
import { useSettings } from '../../store/settings'
import { Seg } from '../atoms'

export function InstrumentSeg({ name }: { name: string }) {
  const instrument = useSettings((s) => s.instrument)
  const set = useSettings((s) => s.set)
  return (
    <span className="inst-seg" title="Concert pitch for piano; written pitch for E♭ alto or B♭ tenor sax">
      <Seg
        mini
        name={name}
        label="Instrument"
        value={instrument}
        options={[
          ['concert', 'Concert'],
          ['alto', 'Alto'],
          ['tenor', 'Tenor'],
        ]}
        onChange={(v) => set({ instrument: v })}
      />
    </span>
  )
}
