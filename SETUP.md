# Setup Guide — image-agent-demo

Пошаговая инструкция для запуска end-to-end демо:
**DALL-E → x402 оплата → grayscale-конвертация → output.jpg**

---

## Обзор того, что нужно

| Что | Зачем |
|-----|-------|
| OpenAI API key | Agent 1 генерирует изображение через DALL-E 2 |
| MetaMask кошелёк | Хранит тестовый USDC для оплаты Agent 2 |
| Тестовый ETH (Base Sepolia) | Оплата gas при подписи USDC-транзакции |
| Тестовый USDC (Base Sepolia) | Реальная (но тестовая) оплата $0.01 за конвертацию |

---

## Шаг 1 — Получи OpenAI API Key

1. Зайди на **https://platform.openai.com/api-keys**
2. Нажми **"Create new secret key"**
3. Скопируй ключ — он показывается только один раз
4. Убедись что на аккаунте есть кредиты (хотя бы $1 — DALL-E 2 / 256px стоит ~$0.002 за изображение)

---

## Шаг 2 — Установи MetaMask и создай кошелёк

1. Скачай MetaMask: **https://metamask.io/download/**
2. Создай новый кошелёк → **сохрани seed phrase в надёжном месте**
3. После создания:
   - Нажми на иконку аккаунта → **"Account details"**
   - Нажми **"Show private key"** → введи пароль
   - Скопируй приватный ключ (начинается с `0x`)

> ⚠️ Это тестовый кошелёк. **Никогда не используй его для реальных средств.**

---

## Шаг 3 — Добавь сеть Base Sepolia в MetaMask

### Вариант A — автоматически (рекомендуется)
1. Зайди на **https://chainlist.org**
2. Включи переключатель **"Testnets"**
3. В поиске введи **"Base Sepolia"**
4. Нажми **"Add to MetaMask"** → подтверди

### Вариант B — вручную
В MetaMask: Settings → Networks → Add network → Add manually:

| Поле | Значение |
|------|----------|
| Network Name | Base Sepolia |
| RPC URL | `https://sepolia.base.org` |
| Chain ID | `84532` |
| Currency Symbol | `ETH` |
| Block Explorer | `https://sepolia.basescan.org` |

---

## Шаг 4 — Получи тестовый ETH для gas

Нужно небольшое количество ETH на Base Sepolia чтобы оплачивать gas при подписи транзакций.

Официальный список фосетов от команды Base:
**https://docs.base.org/tools/network-faucets**

Рекомендуемые (работают без верификации аккаунта):
- **Alchemy Base Sepolia Faucet** — https://www.alchemy.com/faucets/base-sepolia
  *(требует аккаунт Alchemy, выдаёт 0.1 ETH / день)*
- **QuickNode Faucet** — https://faucet.quicknode.com/base/sepolia
  *(требует QuickNode аккаунт)*

Порядок действий:
1. Открой нужный фосет
2. Вставь адрес своего кошелька (из MetaMask, формат `0x...`)
3. Получи тестовый ETH — обычно приходит за 1-2 минуты

> Нужно совсем немного: 0.001 ETH хватит на сотни тестовых транзакций.

---

## Шаг 5 — Получи тестовый USDC на Base Sepolia

1. Зайди на **https://faucet.circle.com**
2. Выбери сеть **"Base Sepolia"**
3. Вставь адрес своего кошелька
4. Нажми **"Send"** — придёт 10 USDC (достаточно для 1000 тестовых оплат по $0.01)

**Адрес контракта USDC на Base Sepolia:**
`0x036CbD53842c5426634e7929541eC2318f3dCF7e`

Чтобы USDC отображался в MetaMask:
Tokens → Import token → вставь адрес выше.

---

## Шаг 6 — Заполни .env файлы

### colorizer-service/.env

```bash
cp colorizer-service/.env.example colorizer-service/.env
```

Открой `colorizer-service/.env` и заполни:

```dotenv
# Ключ OpenAI (нужен для LLM внутри агента)
OPENAI_API_KEY=sk-proj-...твой-ключ...

# Адрес кошелька ПОЛУЧАТЕЛЯ платежей (можно тот же кошелёк что и плательщик)
# Это адрес куда приходят $0.01 USDC за каждую конвертацию
PAYMENT_RECIPIENT_ADDRESS=0x...твой-адрес...

# Приватный ключ для ERC-8004 регистрации (нужен только для `npm run register`)
# Для локального теста можно оставить заглушку ниже:
ERC8004_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000001
```

### image-generator/.env

```bash
cp image-generator/.env.example image-generator/.env
```

Открой `image-generator/.env` и заполни:

```dotenv
# Ключ OpenAI (нужен для DALL-E 2)
OPENAI_API_KEY=sk-proj-...твой-ключ...

# Приватный ключ ПЛАТЕЛЬЩИКА (кошелёк с тестовым USDC на Base Sepolia)
# Формат: 0x + 64 hex символа
PAYER_PRIVATE_KEY=0x...твой-приватный-ключ...

# URL colorizer-service (оставь по умолчанию для локального теста)
COLORIZER_URL=http://localhost:3000/agent
```

---

## Шаг 7 — Проверь настройку

```bash
cd image-generator
npm run check
```

Скрипт проверит:
- ✓ Все env переменные заполнены
- ✓ PAYER_PRIVATE_KEY — валидный приватный ключ
- ✓ ETH баланс кошелька на Base Sepolia (нужен для gas)
- ✓ USDC баланс >= $0.01 (10 000 units)

---

## Шаг 8 — Запуск

### Терминал 1 — запусти Agent 2 (colorizer-service)

```bash
cd colorizer-service
npx aixyz dev
```

Ожидаемый вывод:
```
➫ aixyz.sh v0.24.0
- A2A:  http://localhost:3000/.well-known/agent-card.json
- MCP:  http://localhost:3000/mcp

✓ Ready in ~700ms
```

### Терминал 2 — запусти Agent 1 (image-generator)

```bash
cd image-generator
npm start "a golden retriever sitting in a sunlit meadow"
```

Ожидаемый вывод:
```
=== image-generator ===
Prompt: "a golden retriever sitting in a sunlit meadow"

[1/3] Generating image with DALL-E 2...
  → Requesting DALL-E 2 image for: "..."
  ✓ Image generated (≈35 KB as base64)

[2/3] Sending to colorizer-service (Agent 2)...
  → POST http://localhost:3000/agent  (task 550e8400-...)

Агент 2 запрашивает оплату $0.01 USDC на Base Sepolia. Подтвердить? (y/n) > y

  → Подписываю платёж (EIP-3009)...
  → Повторный запрос с X-PAYMENT заголовком...
  ✓ Grayscale image received (≈28 KB)

[3/3] Saving output.jpg...

=== Done ===
✓ Saved to: output.jpg
✓ Payment txHash: 0xabc123...
```

---

## Troubleshooting

| Ошибка | Причина | Решение |
|--------|---------|---------|
| `PAYER_PRIVATE_KEY not set` | Не заполнен .env | Повтори Шаг 6 |
| `Payment rejected (402)` | Нет USDC на кошельке | Повтори Шаг 5 |
| `EADDRINUSE port 3000` | Порт уже занят | `npx kill-port 3000` |
| `Cannot find module tsx` | Не установлены deps | `npm install` в image-generator/ |
| `DALL-E: insufficient_quota` | Нет кредитов OpenAI | Пополни баланс на platform.openai.com |
| Grayscale image is blank | sharp не установлен | `npm install` в colorizer-service/ |
