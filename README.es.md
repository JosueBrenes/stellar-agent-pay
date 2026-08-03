# stellar-agent-pay

Plugin de CLI para Stellar que permite a un agente de IA desbloquear recursos HTTP de pago (x402) con USDC, bajo una política de gasto que vos controlás, y con una bitácora legible de cada intento.

English version: [README.md](README.md).

## Por qué

x402 convierte el HTTP 402 en un handshake de pago real: el servidor responde `402 Payment Required` con las condiciones en formato máquina, el cliente firma el pago y reintenta la petición. En Stellar el cliente firma solo entradas de autorización del contrato, y el facilitador de OpenZeppelin Channels arma, patrocina y envía la transacción, así que un agente puede pagar con USDC y cero XLM.

Eso hace trivial que un agente autónomo gaste dinero. `stellar-agent-pay` mete una política entre el 402 y la firma:

- La política se evalúa en `onBeforePaymentCreation`, el último punto antes de firmar cualquier entrada de autorización. Un pago rechazado nunca genera una firma.
- Todo intento, pagado o rechazado, se anexa a `~/.stellar-agent-pay/audit.log`.
- Los presupuestos se calculan desde el registro local de pagos liquidados: por petición, por dominio en 24 h y por agente en 24 h.

## Instalación

```bash
npm install -g stellar-agent-pay
```

O desde el código fuente:

```bash
git clone https://github.com/JosueBrenes/stellar-agent-pay.git
cd stellar-agent-pay
npm install
npm run build
npm link
```

`npm link` deja `stellar-agent-pay` en tu PATH. La CLI de Stellar resuelve `stellar <nombre>` a un binario `stellar-<nombre>`, así que ambas formas funcionan:

```bash
stellar-agent-pay unlock <url>
stellar agent-pay unlock <url>
```

Requiere Node.js 20 o superior.

## Inicio rápido

```bash
# 1. valores conservadores en ~/.stellar-agent-pay/policy.json
stellar-agent-pay init

# 2. pagador de testnet: llaves + XLM de friendbot + trustline de USDC
stellar-agent-pay wallet new --fund

# 3. cargalo con USDC de testnet (captcha web, no hay API)
#    https://faucet.circle.com  ->  la dirección G... que se imprimió arriba

# 4. habilitá un dominio, con su propio techo
stellar-agent-pay policy allow api.example.com --max-per-request 0.01

# 5. pagá y leé el recurso
stellar-agent-pay unlock https://api.example.com/weather
```

Nada es gastable hasta que habilités un dominio. La política por defecto bloquea toda petición de pago.

## Probarlo sin llaves ni fondos

El repo incluye un vendedor x402 simulado que corre offline. Emite respuestas 402 correctas según el protocolo, sin facilitador, sin API key y sin dinero, suficiente para ejercitar toda la ruta de política:

```bash
npm run demo:mock            # http://localhost:4021

stellar-agent-pay unlock http://localhost:4021/weather --dry-run         # bloqueado: dominio no habilitado
stellar-agent-pay policy allow localhost
stellar-agent-pay unlock http://localhost:4021/weather --dry-run         # permitido: 0.001 USDC
stellar-agent-pay unlock http://localhost:4021/premium-report --dry-run  # bloqueado: 0.50 supera el techo de 0.05
stellar-agent-pay audit
```

`npm run smoke` corre exactamente eso como verificación automatizada de punta a punta.

Para el ciclo real contra Stellar testnet, `examples/seller` es un servidor `@x402/express` que liquida a través del facilitador de OZ Channels. Ver [examples/README.md](examples/README.md).

## Comandos

| Comando                                     | Qué hace                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| `unlock <url>`                              | Pide el recurso, paga el 402 si la política lo permite, imprime el cuerpo |
| `unlock <url> --dry-run`                    | Negocia el 402 y muestra el veredicto sin firmar nada                     |
| `status`                                    | Dirección del pagador, saldos, política activa, gasto de las últimas 24 h |
| `policy show`                               | Imprime la política activa                                                |
| `policy set <clave> <valor>`                | Cambia un límite o una lista                                              |
| `policy allow <dominio>`                    | Habilita un dominio, con límites propios opcionales                       |
| `policy block / unblock / remove <dominio>` | Administra la lista negra y la lista blanca                               |
| `policy reset`                              | Restaura los valores por defecto                                          |
| `wallet new --fund`                         | Genera el pagador, lo fondea en testnet y agrega la trustline de USDC     |
| `wallet import <secreto>`                   | Guarda una llave `S...` existente (también lee stdin)                     |
| `wallet trustline`                          | Agrega la trustline de USDC al pagador configurado                        |
| `audit`                                     | Lee la bitácora, filtra por dominio o resultado                           |
| `init`                                      | Crea `~/.stellar-agent-pay` con una política conservadora                 |

`unlock` escribe el cuerpo del recurso en stdout y todo lo demás en stderr, así que los pipes quedan limpios:

```bash
stellar-agent-pay unlock https://api.example.com/weather | jq .temp
stellar-agent-pay unlock https://api.example.com/weather --json | jq '{tx, amount, body}'
```

Códigos de salida: `0` desbloqueado, `1` error de petición o liquidación, `2` bloqueado por la política. Un agente puede ramificar con el `2` sin parsear texto.

## La política de gasto

`~/.stellar-agent-pay/policy.json`:

```json
{
  "version": 1,
  "allowedNetworks": ["stellar:testnet"],
  "maxPerRequest": "0.05",
  "maxPerDomainPerDay": "1.00",
  "maxPerDayPerAgent": "5.00",
  "allowedDomains": ["api.example.com", "*.data.example.org"],
  "blockedDomains": [],
  "allowUnlistedDomains": false,
  "allowedAssets": [],
  "requireHttps": false,
  "domainOverrides": {
    "api.example.com": { "maxPerRequest": "0.25", "maxPerDay": "3.00" }
  }
}
```

| Regla                   | `rule=` en la bitácora   | Rechaza cuando                                                              |
| ----------------------- | ------------------------ | --------------------------------------------------------------------------- |
| Transporte              | `transport`              | `requireHttps` está activo y la URL es texto plano (localhost queda exento) |
| Red                     | `network`                | El 402 pide una red fuera de `allowedNetworks`                              |
| Lista negra             | `domain_blocked`         | El host coincide con `blockedDomains`                                       |
| Lista blanca            | `domain_allowlist`       | El host no está en `allowedDomains` y `allowUnlistedDomains` es false       |
| Activo                  | `asset`                  | `allowedAssets` está definido y el activo no aparece ahí                    |
| Por petición            | `max_per_request`        | El pago individual supera el techo                                          |
| Presupuesto por dominio | `max_per_domain_per_day` | Lo liquidado en ese host en 24 h más este pago supera el tope               |
| Presupuesto del agente  | `max_per_day_per_agent`  | Lo liquidado en todos los hosts en 24 h más este pago supera el tope        |

Notas:

- Los dominios admiten un comodín inicial, `*.example.com`, que cubre subdominios pero no el dominio pelado.
- `domainOverrides` gana sobre los límites globales: primero el host exacto, luego el comodín más largo.
- Los presupuestos usan una ventana móvil de 24 h calculada desde `events.jsonl`, contando solo pagos liquidados. Los intentos bloqueados o fallidos quedan auditados pero nunca consumen presupuesto.
- Los montos se expresan en unidades de 7 decimales. Los activos de Stellar llevan 7 decimales, no 6. No se aplica conversión entre activos distintos.

## Bitácora de auditoría

Dos archivos, escritos en cada intento:

- `audit.log`, una línea por intento, apta para grep.
- `events.jsonl`, el registro estructurado que alimenta la contabilidad de presupuestos.

```
2026-08-03T14:12:44.907Z  PAID       api.example.com   0.001 USDC   GET https://api.example.com/weather  network=stellar:testnet tx=8f3c...
2026-08-03T14:14:07.919Z  BLOCKED    api.example.com   0.50 USDC    GET https://api.example.com/premium-report  rule=max_per_request reason="0.50 USDC exceeds max per request of 0.05"
```

Resultados: `paid`, `blocked`, `failed`, `simulated` (dry run), `free` (no hubo que pagar).

```bash
stellar-agent-pay audit --tail 50
stellar-agent-pay audit --result blocked
stellar-agent-pay audit --domain api.example.com --json | jq .
```

## Configuración

| Variable                  | Para qué sirve                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `STELLAR_SECRET_KEY`      | Secreto del pagador. Tiene prioridad sobre la wallet guardada, así nada toca el disco |
| `STELLAR_NETWORK`         | Identificador CAIP-2 de red, por defecto `stellar:testnet`                            |
| `STELLAR_AGENT_PAY_HOME`  | Mueve el directorio de configuración, útil para pruebas y para aislar agentes         |
| `STELLAR_AGENT_PAY_DEBUG` | Imprime trazas de pila                                                                |
| `NO_COLOR`                | Desactiva el color                                                                    |

Un archivo `.env` en el directorio de trabajo se carga automáticamente.

## Seguridad

La llave del pagador se guarda en texto plano en `~/.stellar-agent-pay/wallet.json` con permisos `0600` donde la plataforma lo soporta. Para cualquier cosa más allá de testnet, usá `STELLAR_SECRET_KEY`, mantené el saldo bajo, y tratá la política como un límite de presupuesto para un agente que vos ejecutás, no como defensa ante una máquina comprometida. El modelo de amenazas completo está en [SECURITY.md](SECURITY.md).

## Mainnet

Cambiá el entorno, no el código:

```bash
STELLAR_NETWORK=stellar:pubnet
stellar-agent-pay policy set allowedNetworks stellar:pubnet
stellar-agent-pay policy set requireHttps true
```

Probá primero en testnet, y bajá los límites antes de subirlos.

## Desarrollo

```bash
npm install
npm run typecheck
npm run lint
npm test          # pruebas unitarias de montos, política, motor y auditoría
npm run build
npm run smoke     # corrida offline de punta a punta contra el vendedor simulado
```

## Hoja de ruta

El modo canal de MPP (un depósito, compromisos acumulativos fuera de cadena por petición, una sola liquidación al cerrar) todavía no se incluye. Hoy `@stellar/mpp` fija `@stellar/stellar-sdk@^15` mientras que `@x402/stellar@2.20` requiere `^16`, y además el modo canal necesita desplegar un contrato de canal unidireccional por sesión. Va a llegar como integración opcional cuando eso se resuelva, reutilizando el mismo motor de política y la misma bitácora.

## Licencia

MIT. Ver [LICENSE](LICENSE).
