# Image Agent Demo — ERC-8004 Reference Implementation

## Что это

Эталонная реализация полного стека **ERC-8004 + A2A + x402** на двух AI-агентах.

Два агента взаимодействуют через открытый протокол:
- **Agent 1 — Image Generator** (клиент): генерирует изображения через DALL-E 2 и отправляет их на раскраску
- **Agent 2 — Colorizer Service** (сервер): принимает изображение, конвертирует в ч/б и возвращает результат

Каждый шаг взаимодействия оставляет верифицируемый след on-chain:
оплата через x402, репутация через ERC-8004 Reputation Registry, хеши артефактов через Validation Registry.

## Полный стек

```
┌─────────────────────────────────────────────────────────────────────┐
│  Image Generator (Agent 1)                                          │
│                                                                     │
│  npm start "a golden retriever"                                     │
│         │                                                           │
│  [1/5]  DALL-E 2 → imageBase64                                      │
│         │                                                           │
│  [2/5]  ERC-8004 Discovery                                          │
│         │  tokenURI(agentId) → ipfs://CID                          │
│         │  fetch(CID) → registration file                           │
│         │  services[type=a2a].url → http://localhost:3000/agent     │
│         │                                                           │
│  [2/5]  A2A message/send ──────────────────────────────────────┐   │
│         │  HTTP 402 ← x402 payment required                     │   │
│         │  sign EIP-3009 (off-chain, USDC on Base Sepolia)      │   │
│         │  retry with X-PAYMENT header                          │   │
│         │                                                           │
│         │              ┌─────────────────────────────────────┐  │   │
│         │              │  Colorizer Service (Agent 2)         │  │   │
│         └──────────────►  x402 middleware: verify + settle    │  │   │
│                        │  sharp().grayscale().png()           │  │   │
│                        │  → grayscaleBase64                   │  │   │
│                        └──────────────┬──────────────────────┘  │   │
│         ◄─────────────────────────────┘                          │   │
│  [3/5]  output.jpg saved                                            │
│         │                                                           │
│  [4/5]  ERC-8004 Reputation Registry                                │
│         │  giveFeedback(agentId, value=100, tag="successRate")      │
│         │  feedbackURI = ipfs://CID (off-chain JSON с proof)        │
│         │                                                           │
│  [5/5]  ERC-8004 Validation Registry                                │
│         │  validationRequest(agentId,                               │
│         │    inputHash=keccak256(imageBase64),                      │
│         │    outputHash=keccak256(grayscaleBase64))                 │
│         │  requestURI = ipfs://CID (task + payment context)         │
└─────────────────────────────────────────────────────────────────────┘
```

## Структура проекта

```
image-agent-demo/
│
├── colorizer-service/          Agent 2 — HTTP-сервер
│   ├── app/
│   │   ├── agent.ts            Обработчик A2A запросов (детерминированный, без LLM)
│   │   ├── server.ts           AixyzApp: A2APlugin + MCPPlugin + x402 middleware
│   │   ├── mock-facilitator.ts Мок x402 facilitator для локальной разработки
│   │   └── tools/
│   │       └── colorize.ts     sharp().grayscale() + MCP tool wrapper
│   └── aixyz.config.ts         Метаданные агента: name, description, skills, x402
│
├── image-generator/            Agent 1 — CLI-клиент
│   └── src/
│       ├── index.ts            Точка входа: 5 шагов (DALL-E → A2A → save → reputation → validation)
│       ├── dalle.ts            DALL-E 2 256×256 base64
│       ├── colorizer-client.ts A2A + x402 платёжный флоу
│       └── check-env.ts        Pre-flight проверка env и баланса кошелька
│
└── erc8004/                    ERC-8004 стек
    ├── contracts/
    │   └── registry-addresses.json   Адреса трёх реестров на Base Sepolia
    ├── registration/
    │   ├── colorizer.json            ERC-8004 registration file (Agent 2)
    │   └── image-generator.json      ERC-8004 registration file (Agent 1)
    └── scripts/
        ├── register.ts         On-chain регистрация обоих агентов (mint NFT)
        ├── discovery.ts        Поиск агента через tokenURI → IPFS → endpoint
        ├── reputation.ts       submitFeedback() после каждого вызова
        ├── validation.ts       requestValidation() с хешами артефактов
        └── read-reputation.ts  CLI: чтение репутации агента
```

## Quickstart

### Шаг 1 — Установка зависимостей

```bash
cd colorizer-service && npm install && cd ..
cd image-generator   && npm install && cd ..
cd erc8004           && npm install && cd ..
```

### Шаг 2 — Настройка .env файлов

```bash
# colorizer-service (получатель платежей)
cp colorizer-service/.env.example colorizer-service/.env

# image-generator (плательщик + клиент)
cp image-generator/.env.example image-generator/.env

# erc8004 (on-chain регистрация и репутация)
cp erc8004/.env.example erc8004/.env
```

Заполнить в каждом `.env`:

| Файл | Переменная | Где получить |
|---|---|---|
| `colorizer-service/.env` | `PAYMENT_RECIPIENT_ADDRESS` | Адрес вашего кошелька MetaMask |
| `image-generator/.env` | `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `image-generator/.env` | `PAYER_PRIVATE_KEY` | MetaMask → Account Details → Show private key |
| `erc8004/.env` | `PINATA_JWT` | [app.pinata.cloud/developers/api-keys](https://app.pinata.cloud/developers/api-keys) |
| `erc8004/.env` | `ERC8004_PRIVATE_KEY` | Тот же что `PAYER_PRIVATE_KEY` |

Пополнить кошелёк на Base Sepolia:
- ETH (газ): [alchemy.com/faucets/base-sepolia](https://www.alchemy.com/faucets/base-sepolia)
- USDC: [faucet.circle.com](https://faucet.circle.com) → выбрать Base Sepolia

### Шаг 3 — Pre-flight проверка

```bash
cd image-generator
npm run check    # проверяет env, формат ключей, балансы ETH и USDC
```

### Шаг 4 — Регистрация агентов on-chain

```bash
cd erc8004
npm run register
```

Скрипт:
1. Загружает `colorizer.json` и `image-generator.json` на IPFS через Pinata
2. Вызывает `register(agentURI)` на IdentityRegistry → минтит NFT для каждого агента
3. Обновляет `registrations[]` в обоих JSON-файлах с полученными `agentId`
4. Загружает обновлённые файлы на IPFS и вызывает `setAgentURI(agentId, newCID)`

После этого агенты доступны для discovery по всему ERC-8004 экосистему.

### Шаг 5 — Запуск демо

**Терминал 1** — запустить Agent 2:
```bash
cd colorizer-service
npx aixyz dev
# Сервер запущен на http://localhost:3000
```

**Терминал 2** — запустить Agent 1:
```bash
cd image-generator
npm start "a golden retriever in a sunlit meadow"
```

Ожидаемый вывод:
```
=== image-generator ===
Prompt: "a golden retriever in a sunlit meadow"

[1/5] Generating image with DALL-E 2...
  ✓ Image generated (≈38 KB as base64)

[2/5] Sending to colorizer-service (Agent 2)...
  → POST http://localhost:3000/agent

Агент 2 запрашивает оплату $0.01 USDC на Base Sepolia. Подтвердить? (y/n) > y
  → Подписываю платёж (EIP-3009)...
  → Повторный запрос с X-PAYMENT заголовком...

  ✓ Grayscale image received (≈35 KB, 4823ms)

[3/5] Saving output.jpg...

[4/5] Recording ERC-8004 reputation feedback...
  ✓ Feedback recorded
    feedbackIndex : 0
    txHash        : 0xabc...
    IPFS          : ipfs://bafyrei...

[5/5] Submitting ERC-8004 validation request...
  ✓ Validation recorded on-chain
    requestHash : 0xdef...
    txHash      : 0x123...

=== Done ===
✓ Saved to: output.jpg
✓ Payment txHash: 0x456...
```

## ERC-8004 компоненты

### Identity Registry (`0x8004A818BFB912233c491871b3d84c89A494BD9e`)

ERC-721 реестр агентов. Каждый агент — NFT с `tokenURI`, указывающим на registration file.

**Что даёт:**
- Глобальный идентификатор агента: `eip155:84532:0x8004A818.../<tokenId>`
- Censorship-resistant endpoint discovery: клиент читает `tokenURI` on-chain → fetch IPFS → получает актуальный A2A endpoint
- Transferable ownership: NFT можно передать — новый владелец контролирует агента

**Как используется в проекте:**
- `npm run register` → `register(agentURI)` → mint NFT
- `discoverColorizer()` → `tokenURI(agentId)` → fetch registration file → `services[a2a].url`

### Reputation Registry (`0x8004B663056A597Dffe9eCcC1965A193B7388713`)

On-chain хранилище feedback сигналов с защитой от self-feedback.

**Что даёт:**
- Стандартизированная схема: `(int128 value, uint8 decimals, string tag1, string tag2)`
- Любой тип метрики: successRate, uptime, responseTime, tradingYield — один контракт
- Composability: `getSummary(agentId, clientAddresses, tag)` агрегирует данные на цепи
- Proof of payment: off-chain JSON содержит `txHash` платежа → репутация неотделима от реальной экономической активности

**Как используется в проекте:**
- После каждого успешного вызова: `giveFeedback(agentId, 100, 0, "successRate", ...)`
- Off-chain JSON с `a2a.contextId`, `a2a.taskId`, `proofOfPayment` загружается на IPFS
- `feedbackHash = keccak256(JSON)` → хранится on-chain для верификации

### Validation Registry (`0x8004Cb1BF31DAf7788923b405b754f57acEB4272`)

Реестр запросов на независимую верификацию результатов.

**Что даёт:**
- Стандартный интерфейс для любого типа валидатора: zkML, TEE oracle, stake-secured re-execution
- Двухфазный протокол: owner создаёт `validationRequest`, validator отвечает `validationResponse`
- Неизменяемый audit trail: request hash + response hash + timestamp on-chain

**Как используется в проекте:**
- `validationRequest(0x000...0, agentId, requestURI, requestHash)` — self-attestation
- Request file содержит `keccak256(inputImage)` и `keccak256(outputImage)`: любой валидатор может воспроизвести конвертацию и проверить хеши
- `0x000...0` как validator = "self" — достаточно для демо. Реальный сценарий: zkML prover, который верифицирует grayscale transform через zero-knowledge proof

## Discovery цикл

ERC-8004 создаёт самоусиливающийся цикл, где каждый шаг улучшает следующий:

```
         ┌──────────────────────────────────────────┐
         │                                          │
         ▼                                          │
  ┌─────────────┐                                   │
  │  DISCOVERY  │  tokenURI → IPFS → endpoint       │
  │             │  Клиент находит агента             │
  │             │  без предварительного доверия      │
  └──────┬──────┘                                   │
         │                                          │
         ▼                                          │
  ┌─────────────┐                                   │
  │  COMMERCE   │  A2A + x402                       │
  │             │  $0.01 USDC за вызов               │
  │             │  EIP-3009: off-chain подпись       │
  └──────┬──────┘                                   │
         │                                          │
         ▼                                          │
  ┌─────────────┐                                   │
  │  REPUTATION │  giveFeedback(successRate=100)    │
  │             │  + proofOfPayment (txHash)         │
  │             │  Репутация = экономически значимая │
  └──────┬──────┘                                   │
         │                                          │
         ▼                                          │
  ┌─────────────┐                                   │
  │ VALIDATION  │  validationRequest(               │
  │             │    inputHash, outputHash)          │
  │             │  Audit trail артефактов            │
  └──────┬──────┘                                   │
         │                                          │
         ▼                                          │
  ┌─────────────┐                                   │
  │   BETTER    │  getSummary(agentId, clients)     ├─┘
  │  DISCOVERY  │  Новые клиенты видят репутацию     │
  │             │  → выбирают проверенных агентов    │
  └─────────────┘
```

**Почему это важно:**

Без ERC-8004 агенты — анонимные HTTP-эндпоинты. Клиент вынужден доверять заранее известному URL и не имеет способа проверить качество работы агента до взаимодействия.

С ERC-8004 любой клиент может:
1. Найти агента по on-chain идентификатору (не по URL)
2. Проверить его репутацию до оплаты (`getSummary`)
3. Убедиться, что репутация привязана к реальным платежам (`proofOfPayment`)
4. После взаимодействия пополнить репутационную историю

Это "open-ended agent economy" — агенты конкурируют за репутацию в открытой системе.

## Полезные команды

```bash
# Проверить балансы и конфигурацию
cd image-generator && npm run check

# Зарегистрировать агентов on-chain
cd erc8004 && npm run register

# Проверить discovery
cd erc8004 && npm run discover

# Прочитать репутацию (после нескольких запусков)
cd erc8004 && npm run reputation -- --agentId 1 --client 0xYourAddress

# Запустить Colorizer Service (Agent 2)
cd colorizer-service && npx aixyz dev

# Запустить демо
cd image-generator && npm start "a cat on a rooftop at sunset"
```

## Контракты ERC-8004 на Base Sepolia

| Registry | Адрес | Explorer |
|---|---|---|
| Identity | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | [basescan](https://sepolia.basescan.org/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) |
| Reputation | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | [basescan](https://sepolia.basescan.org/address/0x8004B663056A597Dffe9eCcC1965A193B7388713) |
| Validation | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` | [basescan](https://sepolia.basescan.org/address/0x8004Cb1BF31DAf7788923b405b754f57acEB4272) |

Адреса детерминированы через CREATE2 — одинаковы на всех сетях (Ethereum Sepolia, Base Sepolia, Arbitrum, Polygon и др.).

Исходный код контрактов: [github.com/erc-8004/erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts)
