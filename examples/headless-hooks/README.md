# Headless hooks

Lykia's logic with your own markup. `PayrollButton` plans a payroll run
(one send per payee, each with a memo), shows the Fence verdict and every
step's fees, then signs each step with the user's wallet. `TokenBadge`
runs a Scent check.

```tsx
import { LykiaProvider, useLykiaPlan } from "@lykia/widget";

const plan = useLykiaPlan();
await plan.plan({ text: "send 25 USDC to 0x…" }); // or { actions: [...] }
await plan.run();                                 // prepare, sign, submit every step
```

Hooks: `useLykiaPlan`, `useLykiaChat`, `useFence`, `useScent`, `useFlock`,
`usePack`, `useOutrun`. Each one wraps a framework-free controller
(`createPlanController` and friends), so the same logic runs in Vue,
Svelte or a test without React.

```bash
node --test examples/headless-hooks/test
```
