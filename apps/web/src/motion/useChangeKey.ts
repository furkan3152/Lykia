import { useState } from "react";

/**
 * A counter that increments each time `value` changes after mount (0 on the
 * first render). Key one-shot animations (stamp thump, digit roll) to real
 * transitions so restored or already-settled state never replays them:
 *
 *   const key = useChangeKey(settled);
 *   <HutStamp key={key} animate={key > 0} />
 */
export function useChangeKey(value: unknown): number {
  const [record, setRecord] = useState<{ readonly value: unknown; readonly key: number }>(() => ({ value, key: 0 }));
  if (!Object.is(record.value, value)) {
    const next = { value, key: record.key + 1 };
    setRecord(next);
    return next.key;
  }
  return record.key;
}
