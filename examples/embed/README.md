# Embed: Routed by Lykia

A live strip of the Arc ecosystem for any web page: every protocol, what
Lykia does with it, and its TVL on Arc. Two lines of HTML, no build step,
no cookies:

```html
<div data-lykia-ecosystem data-limit="6"></div>
<script async src="https://lykia-akdogan1.vercel.app/embed/routed-by-lykia.js"
        data-api="https://lykia-api-akdogan1.vercel.app"></script>
```

| Attribute | On | Meaning |
|---|---|---|
| `data-limit` | the div | How many stalls to show (1 to 24, default 6). |
| `data-protocol` | the div | Show one registry id only, for example `aave-v4`. |
| `data-api` | the script | Another Lykia API origin. |

Open `index.html` in a browser to try it. To check it from a terminal:

```bash
node examples/embed/check.mjs
```

The data is `GET /v1/ecosystem`: public, cached for 60 seconds and readable
from any origin, so you can also draw it your own way.
