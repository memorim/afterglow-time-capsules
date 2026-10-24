# Afterglow — цифровые капсулы времени

Сохраняет сообщение с паролем и проверяемой на сервере датой открытия.

**Проект:** Самостоятельная разработка.

![CI](https://github.com/memorim/afterglow-time-capsules/actions/workflows/ci.yml/badge.svg)

![Компьютерная версия](docs/desktop.png)

<img src="docs/mobile.png" width="320" alt="Мобильная версия">

[Короткая демонстрация сценария](docs/demo.gif)

## Что работает
- Создание и список капсул, открытие по паролю после заданной даты.
- AES-256-GCM, scrypt, случайные salt и IV.
- Скрытие шифротекста из публичного API.

## Стек
JavaScript, Node Crypto, Express, SQLite, Zod, HTML, CSS.

## Запуск и проверка
Node.js 24.18.0 и pnpm 11.7.0.

```bash
npm install --global pnpm@11.7.0
pnpm install --frozen-lockfile
pnpm test
pnpm start
```

## Технические решения
- Дата проверяется сервером; неправильный пароль и преждевременный доступ получают разные статусы.
- Тестовые будущие даты вычисляются относительно времени запуска.

## Проверка интерфейса

Playwright проверяет компьютерную и мобильную версии, отсутствие горизонтального прокручивания и повтор загрузки после ответа API 503. Ошибка отправки формы сохраняет введённые данные.

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

## Подробности
[API, конфигурация и исходные инструкции](docs/TECHNICAL.md).

[Результаты проверки этой версии](docs/VERIFICATION.md).

[Пример запроса и ответа API](docs/API_EXAMPLE.md).

## Проверки и обновления
CI проверяет проект и ссылки на локальные материалы. Dependabot предлагает обновления зависимостей и Actions. [История изменений](CHANGELOG.md).

[Контракты API и обновление базы](docs/COMPATIBILITY.md): `pnpm test:contract && pnpm test:upgrade`.
