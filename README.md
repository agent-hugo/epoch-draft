# Epoch Draft

Браузерная карточная игра на 3–5 игроков: драфт карт, развитие цивилизации и
Великое сооружение за три эпохи. Каждый играет со своего телефона, связь между
игроками идёт через MQTT-брокер.

- Правила: [docs/rules.md](docs/rules.md)
- Архитектура и протокол: [docs/architecture.md](docs/architecture.md)

## Разработка

```sh
npm install
npm run dev        # локальный сервер
npm test           # тесты движка
npm run sim -- 300 # баланс: партии ботов
npm run build      # сборка в dist/
```

Сетевые проверки требуют брокер:

```sh
MQTT_URL=wss://... MQTT_TOKEN=... npm run net-smoke   # партия через брокер без UI
MQTT_TOKEN=... npm run e2e                           # партия через интерфейс (Playwright + Chrome)
```

Чтобы играть, нужны адрес MQTT-брокера с WebSocket (TLS) и токен; их вводят в
настройках приложения.
