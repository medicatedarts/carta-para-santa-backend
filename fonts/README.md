# Fuentes para la impresión

Lob descarga las fuentes por URL cuando imprime. Para no depender de Google Fonts, coloca aquí estos archivos woff2 (todas son de licencia OFL, de [fonts.google.com](https://fonts.google.com) o de [google-webfonts-helper](https://gwfh.mranftl.com/fonts)):

| Archivo | Fuente |
| --- | --- |
| `fraunces-500.woff2` | Fraunces 500 |
| `fraunces-700.woff2` | Fraunces 700 |
| `fraunces-700italic.woff2` | Fraunces 700 italic |
| `nunito-400.woff2` | Nunito 400 |
| `nunito-800.woff2` | Nunito 800 |
| `patrickhand-400.woff2` | Patrick Hand 400 |
| `pinyonscript-400.woff2` | Pinyon Script 400 |

Cuando estén los 7, `printTemplate.js` los usa automáticamente desde `BACKEND_PUBLIC_URL/fonts/…`. Mientras falte alguno, usa Google Fonts.
