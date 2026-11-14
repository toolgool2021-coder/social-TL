# NEXORA

Веб-версия социальной сети. Поэтапная интеграция 3.2 в работе; рабочее развёртывание Firebase требует отдельной проверки.

- [Полные требования и статусы](NEXORA_3_2_ROADMAP.md)
- [Firebase: проверки, резервная копия и выпуск](NEXORA_3_2_FIREBASE.md)

Проверки (Node.js 22, Java 21):

```bash
npm ci
npm ci --prefix functions
npm test
```

Тесты используют demo-проект в локальном эмуляторе и не меняют production.
