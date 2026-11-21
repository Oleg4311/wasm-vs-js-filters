# Политика безопасности

## Как сообщить об уязвимости

Пожалуйста, **не создавайте публичный issue**. Сообщите приватно через GitHub: вкладка **Security** → **Report a vulnerability**
([создать сообщение](https://github.com/Oleg4311/wasm-vs-js-filters/security/advisories/new)).

Укажите, что именно не так, как это воспроизвести и какая версия затронута. Я постараюсь ответить в течение недели, но это проект одного человека, поэтому сроки не гарантирую.

## Поддерживаемые версии

Исправления выходят для последней версии: ветка `main` и последний релиз.

## Что считается уязвимостью

Страница обрабатывает загруженные изображения локально, ничего никуда не отправляя. Интересны: внедрение разметки или скрипта через имя файла и содержимое, выход за пределы памяти модуля WebAssembly на специально подготовленных размерах и радиусах, зависание или чрезмерный расход памяти на разумных входных данных.

## Что вне области

Уже известные проблемы в зависимостях (их закрывает Dependabot), атаки, требующие физического доступа к устройству пользователя, и отчёты без способа воспроизведения.

---

## English

Please report vulnerabilities privately via GitHub Security Advisories (**Security** → **Report a vulnerability**) and do not open a public issue. Include what is wrong, how to reproduce it and which version is affected. This is a one-person project, so response times are best-effort. Only the latest release and `main` receive fixes.
