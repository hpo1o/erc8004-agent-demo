# ERC-8004 + x402 Reference Implementation

![Tests](https://img.shields.io/badge/tests-17%20passing-green)
![Network](https://img.shields.io/badge/network-Base%20Sepolia-blue)
![ERC-8004](https://img.shields.io/badge/ERC--8004-Identity%20%2B%20Validation-orange)
![x402](https://img.shields.io/badge/x402-real%20USDC-green)

Эталонная реализация полного стека **ERC-8004 (Agent Identity) + A2A (Agent2Agent) + x402 (HTTP Payments)** на двух AI-агентах. Два агента взаимодействуют через открытые протоколы: Agent 1 находит Agent 2 через блокчейн, платит криптовалютой, получает результат — без заранее известных URL и без доверия к третьей стороне.

**Публичный агент (Agent 2):** https://erc8004-agent-demo-production.up.railway.app

---

## Архитектура

```
┌─────────────────────────────────────────────────────────────────────┐
│  Image Generator — Agent 1 (CLI)                                    │
│                                                                     │
│  npm start "a golden retriever"                                     │
│         │                                                           │
│  [1/5]  DALL-E 2 → imageBase64 (256×256 PNG)                        │
│         │                                                           │
│  [2/5]  ERC-8004 Discovery ─────────────────────────────────────┐   │
│         │  publicClient.readContract(tokenURI(2214))             │   │
│         │  → ipfs://bafkreih6km34e3itewqpt3djsevqesxa2sf...      │   │
│         │  fetch(CID) → registration file                         │   │
│         │  services[name=A2A].endpoint → Railway URL              │   │
│         │◄────────────────────────────────────────────────────────┘   │
│         │                                                           │
│  [2/5]  A2A message/send ──────────────────────────────────────┐   │
│         │  POST /agent  →  HTTP 402 (payment required)          │   │
│         │  parse X-PAYMENT-REQUIRED header                      │   │
│         │  sign EIP-3009 transferWithAuthorization (off-chain)   │   │
│         │  retry POST /agent with X-PAYMENT header              │   │
│         │                                                        │   │
│         │         ┌──────────────────────────────────────────┐   │   │
│         │         │  Colorizer Service — Agent 2 (Railway)   │   │   │
│         └────────►│  x402 middleware: verify + settle USDC   │   │   │
│                   │  sharp().grayscale().png() (no LLM)       │   │   │
│                   │  → grayscaleBase64                         │   │   │
│                   └──────────────────┬───────────────────────┘   │   │
│         ◄────────────────────────────┘                            │   │
│  [3/5]  output.jpg saved                                          │   │
│         │                                                         │   │
│  [4/5]  ERC-8004 Reputation Registry                              │   │
│         │  giveFeedback(agentId=2214, value=100, "successRate")   │   │
│         │  off-chain JSON (contextId + paymentTxHash) → IPFS      │   │
│         │  feedbackHash stored on-chain                           │   │
│         │                                                         │   │
│  [5/5]  ERC-8004 Validation Registry                              │   │
│         │  requestValidation(agentId=2214,                        │   │
│         │    inputHash=keccak256(imageBase64),                    │   │
│         │    outputHash=keccak256(grayscaleBase64))               │   │
│         │  immutable audit trail on-chain                        │   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Зарегистрированные агенты (Base Sepolia)

### Agent 2 — Colorizer Service

| Поле | Значение |
|---|---|
| agentId | **2214** |
| identifier | `eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e/2214` |
| A2A endpoint | `https://erc8004-agent-demo-production.up.railway.app/agent` |
| MCP endpoint | `wss://erc8004-agent-demo-production.up.railway.app/mcp` |
| registration file | [ipfs://bafkreih6km34e3itewqpt3djsevqesxa2sfuqwtlvs3c6qj5mafxk3oeya](https://gateway.pinata.cloud/ipfs/bafkreih6km34e3itewqpt3djsevqesxa2sfuqwtlvs3c6qj5mafxk3oeya) |
| NFT | [basescan](https://sepolia.basescan.org/token/0x8004A818BFB912233c491871b3d84c89A494BD9e/instance/2214) |

### Agent 1 — Image Generator

| Поле | Значение |
|---|---|
| agentId | **2215** |
| identifier | `eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e/2215` |
| registration file | [ipfs://bafkreidvz2xz3aiudzmcxw4k4vh3crxotzmteq2m3vs7zykhyxndvt7j34](https://gateway.pinata.cloud/ipfs/bafkreidvz2xz3aiudzmcxw4k4vh3crxotzmteq2m3vs7zykhyxndvt7j34) |

### ERC-8004 Контракты (Base Sepolia, chainId 84532)

| Registry | Адрес | Explorer |
|---|---|---|
| Identity | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | [basescan](https://sepolia.basescan.org/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) |
| Reputation | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | [basescan](https://sepolia.basescan.org/address/0x8004B663056A597Dffe9eCcC1965A193B7388713) |
| Validation | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` | [basescan](https://sepolia.basescan.org/address/0x8004Cb1BF31DAf7788923b405b754f57acEB4272) |

Адреса детерминированы через CREATE2 — одинаковы на всех EVM-сетях.

---

## Quickstart

### 1. Клонировать и установить зависимости

```bash
git clone <repo>
cd erc8004-agent-demo
npm run install:all
```

### 2. Настроить .env

```bash
cp image-generator/.env.example  image-generator/.env
cp erc8004/.env.example          erc8004/.env
```

Обязательно заполнить в `image-generator/.env`:

| Переменная | Где получить |
|---|---|
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `PAYER_PRIVATE_KEY` | MetaMask → Account Details → Show private key |
| `COLORIZER_URL` | **оставить пустым** — автоматический ERC-8004 discovery |

> `COLORIZER_URL=` (пустая строка) означает что Image Generator найдёт Agent 2 через блокчейн автоматически: читает `tokenURI(2214)` on-chain → fetch IPFS → берёт `services[A2A].endpoint`.
> Заполнить только для локальной разработки: `COLORIZER_URL=http://localhost:3000/agent`

Для `PAYER_PRIVATE_KEY` нужны средства на Base Sepolia:
- ETH (газ): [alchemy.com/faucets/base-sepolia](https://www.alchemy.com/faucets/base-sepolia)
- USDC: [faucet.circle.com](https://faucet.circle.com) → выбрать Base Sepolia

### 3. Запустить демо

```bash
cd image-generator
npm start "a golden retriever in a sunlit meadow"
```

Ожидаемый вывод:

```
=== image-generator ===
Prompt: "a golden retriever in a sunlit meadow"

Discovering Agent 2 via ERC-8004 registry...
  ✓ Discovered: https://erc8004-agent-demo-production.up.railway.app/agent (agentId: 2214)

[1/5] Generating image with DALL-E 2...
  ✓ Image generated (≈38 KB as base64)

[2/5] Sending to colorizer-service (Agent 2)...
  → POST https://erc8004-agent-demo-production.up.railway.app/agent

Агент 2 запрашивает оплату $0.01 USDC на Base Sepolia. Подтвердить? (y/n) > y
  → Подписываю платёж (EIP-3009)...
  → Повторный запрос с X-PAYMENT заголовком...
  ✓ Grayscale image received

[3/5] Saving output.jpg...
[4/5] Recording ERC-8004 reputation feedback...
  ✓ Feedback recorded  feedbackIndex: 0
[5/5] Submitting ERC-8004 validation request...
  ✓ Validation recorded on-chain

=== Done ===
✓ Saved to: output.jpg
✓ Payment txHash: 0x...
```

---

## Wallet Setup

### Зачем нужны два разных кошелька

В этом проекте два кошелька играют разные роли:

- **`PAYER_PRIVATE_KEY`** (`image-generator/.env`) — кошелёк **Agent 1**. Платит $0.01 USDC за каждый вызов colorizer. Подписывает `giveFeedback()` как клиент.
- **`ERC8004_PRIVATE_KEY`** (`erc8004/.env`) — кошелёк **Agent 2**. Владеет NFT агента (agentId 2214) в Identity Registry.

**ERC-8004 Reputation Registry запрещает self-feedback**: контракт отклоняет `giveFeedback()` если `msg.sender == agentOwner`. Если оба ключа одинаковые — Agent 1 является владельцем Agent 2, и шаг репутации будет пропущен с сообщением `⚠ Reputation feedback skipped`.

`output.jpg` при этом сохранится — основной флоу работает независимо от репутации.

### Проверка конфликта кошельков

```bash
cd erc8004
npm run check
```

При совпадении ключей:
```
⚠  WALLET CONFLICT DETECTED
   PAYER_PRIVATE_KEY and ERC8004_PRIVATE_KEY are the same wallet.
   Reputation Registry will be SKIPPED (ERC-8004 forbids self-feedback).
   ...
```

### Создание второго кошелька (MetaMask)

1. MetaMask → иконка аккаунта → **Add account or hardware wallet**
2. **Add a new account** → дать имя "Agent 2 ERC8004"
3. **Account Details** → **Show private key** → скопировать ключ
4. Записать новый адрес, получить тестовый ETH:
   - [alchemy.com/faucets/base-sepolia](https://www.alchemy.com/faucets/base-sepolia) — 0.1 ETH/день
   - [app.optimism.io/faucet](https://app.optimism.io/faucet) — Superchain faucet
5. Записать в `erc8004/.env`: `ERC8004_PRIVATE_KEY=0x<ключ_нового_кошелька>`

---

## ERC-8004 компоненты

### Identity Registry — что реально работает

- `register(agentURI)` минтит ERC-721 NFT → агент получает глобальный идентификатор `eip155:84532:<registry>/<tokenId>`
- `setAgentURI(agentId, newURI)` обновляет указатель на registration file
- `tokenURI(agentId)` возвращает текущий IPFS URI — **единственный источник истины** для discovery
- Image Generator при каждом запуске читает `tokenURI(2214)` on-chain → никаких захардкоженных URL

### Reputation Registry — честное описание

- `giveFeedback(agentId, value, decimals, tag1, tag2, feedbackURI, feedbackHash)` пишет on-chain
- `feedbackURI` указывает на JSON файл на IPFS с `a2a.contextId`, `a2a.taskId`, `proofOfPayment.txHash`
- `feedbackHash = keccak256(JSON)` — верификация off-chain данных через on-chain хеш
- **Требует разных кошельков** (self-feedback запрещён контрактом)
- `getSummary(agentId, [clientAddresses], tag)` агрегирует данные на цепи — любой клиент может проверить репутацию перед оплатой

### Validation Registry — честное описание

| Операция | Статус | Условие |
|---|---|---|
| Validation Request | ✅ on-chain | Всегда выполняется если agentId зарегистрирован |
| Validation Response | ⚠ on-chain | Требует независимого валидатора; пропускается если validator = agent owner |

- `requestValidation(validatorAddress, agentId, requestURI, requestHash)` создаёт immutable запись
- `validatorAddress = owner EOA` — самоаттестация: агент фиксирует хеши входа и выхода
- `requestURI` → IPFS JSON содержит `keccak256(inputImage)` и `keccak256(outputImage)`: любой внешний валидатор может воспроизвести grayscale конвертацию и проверить хеши
- `validationResponse(requestHash, response, responseURI, responseHash, tag)` — ответ валидатора (0–100)
- **Demo limitation**: контракт запрещает owner агента быть его же валидатором (аналогично self-feedback в Reputation Registry). В demo `submitValidationResponse()` пропускается с сообщением `⚠ Validation response skipped: ... (demo limitation)`.
- **Это не верификация** — это audit trail. Реальная верификация: zkML prover, TEE oracle, или stake-secured re-execution агрегатором

---

## Структура проекта

```
erc8004-agent-demo/
│
├── colorizer-service/          Agent 2 — HTTP-сервер (Railway)
│   ├── app/
│   │   ├── agent.ts            Детерминированный обработчик (без LLM)
│   │   ├── server.ts           AixyzApp: A2APlugin + MCPPlugin + x402
│   │   ├── mock-facilitator.ts Мок x402 для локальной разработки
│   │   └── tools/colorize.ts   sharp().grayscale() + MCP tool wrapper
│   └── aixyz.config.ts         Метаданные агента + x402 config
│
├── image-generator/            Agent 1 — CLI-клиент
│   └── src/
│       ├── index.ts            5 шагов: Discovery → DALL-E → A2A → Reputation → Validation
│       ├── dalle.ts            DALL-E 2 256×256 base64
│       └── colorizer-client.ts A2A + x402 платёжный флоу
│
├── erc8004/                    ERC-8004 стек
│   ├── contracts/
│   │   └── registry-addresses.json   Адреса трёх реестров
│   ├── registration/
│   │   ├── colorizer.json            ERC-8004 registration file (Agent 2)
│   │   └── image-generator.json      ERC-8004 registration file (Agent 1)
│   └── scripts/
│       ├── register.ts         On-chain регистрация (mint NFT + upload IPFS)
│       ├── discovery.ts        tokenURI → IPFS → A2A endpoint
│       ├── reputation.ts       submitFeedback() с off-chain JSON на IPFS
│       ├── validation.ts       requestValidation() с хешами артефактов
│       ├── check.ts            Pre-flight: env, балансы, wallet conflict
│       └── read-reputation.ts  CLI: чтение репутации агента
│
└── tests/                      Автотесты (bun test)
    ├── colorize.test.ts         Unit тест executeColorize()
    ├── registration.test.ts     ERC-8004 schema валидация
    └── x402-flow.test.ts        x402 HTTP флоу без блокчейна
```

---

## Полезные команды

```bash
# Pre-flight проверка (env, балансы, wallet conflict)
cd erc8004 && npm run check

# Зарегистрировать агентов on-chain (mint NFT + upload IPFS)
cd erc8004 && npm run register

# Проверить discovery
cd erc8004 && npm run discover

# Прочитать репутацию
cd erc8004 && npm run reputation -- --agentId 2214 --client 0xYourAddress

# Запустить тесты
bun test tests/

# Запустить Agent 2 локально
cd colorizer-service && npx aixyz dev

# Запустить демо
cd image-generator && npm start "a cat on a rooftop at sunset"
```

---

## Proof of Deployment

Последняя регистрация (ERC-8004 schema v1 с `name`/`endpoint`):

| Агент | Операция | Транзакция |
|---|---|---|
| Colorizer (2214) | register() | [0x1bd0e71...](https://sepolia.basescan.org/tx/0x1bd0e710e571e05a0b297ca9b7d48062b2da281deac64a18c9fb60d5fa8103d0) |
| Colorizer (2214) | setAgentURI() | [0x67e6bdb...](https://sepolia.basescan.org/tx/0x67e6bdbf6427b62e2b1484ab813729bc11d0048f64bb29fa904d5dcd73a16077) |
| Image Generator (2215) | register() | [0xce6a457...](https://sepolia.basescan.org/tx/0xce6a457ba9f6cb11d6e424afca4ba8e5f3d703f7d170a5f78e95211688f3c91c) |
| Image Generator (2215) | setAgentURI() | [0x9a816ba...](https://sepolia.basescan.org/tx/0x9a816ba4dc40d25b6dc375efb86a9957f5d8a70350c9210a789ec4ce6bc6aae5) |

Исходный код контрактов: [github.com/erc-8004/erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts)
