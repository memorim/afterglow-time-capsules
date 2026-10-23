# Пример API

Ответ получен при локальном запуске проверяемой версии. Данные демонстрационные.

```http
GET /api/capsules/1 HTTP/1.1
Host: localhost:4800
```

HTTP 200

```json
{
  "id": 1,
  "title": "Свет самого длинного дня",
  "sender": "Роман",
  "recipient": "Будущему себе",
  "unlock_at": "2026-06-21T09:00:00",
  "theme": "solstice",
  "color": "#f0c96b",
  "hint": "Пароль для демо: light",
  "created_at": "2026-05-11T18:20:00",
  "locked": false
}
```
