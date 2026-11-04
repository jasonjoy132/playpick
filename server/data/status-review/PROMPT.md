# 외부 AI에게 줄 질문 (게관위 '모름' 게임 서비스 상태)

`unknown-games-part1.csv` ~ `part7.csv`(200개씩)를 하나씩 첨부하거나 붙여 넣고, 아래 글을 함께 보내세요.
웹 검색이 되는 AI(검색 켜기)를 쓰면 훨씬 정확해요.

---

첨부한 CSV는 한국 게임물관리위원회(GRAC)에서 등급분류를 받은 게임 목록이야. (id, 제목, 업체, 플랫폼, 장르, 등급분류일)
각 게임의 **오늘 기준 서비스 상태**를 판단해 줘.

- `released`: 이 게임을 정확히 특정할 수 있고, 지금도 플레이·구매할 수 있음
  - 디스크·패키지로 파는 콘솔/PC 게임은 실제로 출시됐으면 released
  - 모바일·온라인·웹보드·아케이드 게임은 지금도 서비스(운영) 중이고 스토어·매장에 있을 때만 released
- `ended`: 서비스 종료, 서버 종료, 스토어에서 내려감을 확인함
- `upcoming`: 발표·등급분류는 됐지만 아직 출시 전
- `unknown`: 이 게임을 특정할 수 없거나 확실하지 않음 (모르면 반드시 unknown, 제목·장르로 추측하지 말 것)

답은 **CSV 한 덩어리로만** 줘. 다른 설명은 쓰지 마.
열: `id,status,evidence`
- id는 첨부한 그대로
- status는 released / ended / upcoming / unknown 중 하나
- evidence는 판단 근거(확인한 페이지 주소나 짧은 근거). 모르면 비워 둬

예:
```
id,status,evidence
1,unknown,
2,ended,https://example.com/notice (2024-03 서비스 종료 공지)
3,released,https://play.google.com/store/apps/details?id=...
```

---

받은 답은 `server/data/status-review/` 폴더에 `result-part1.csv`처럼 저장한 뒤(또는 채팅으로 저에게 주세요)
`npm run import:status -- server/data/status-review/result-part1.csv` 로 반영합니다.
