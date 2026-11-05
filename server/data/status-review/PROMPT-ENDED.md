# 외부 AI에게 줄 질문 (IGDB 게임 서비스 종료 여부)

1. `npm run prefill:ended -- --export` 로 목록을 만듭니다 (이 폴더에 `ended-games-part1.csv` ~ 가 200개씩 생김).
   - 게임위 등급을 받은 IGDB 게임만: `npm run prefill:ended -- --export --only grac`
   - **Gemini가 '서비스 중'이라 한 게임까지 다시 확인**(최근 종료 잡기): `npm run prefill:ended -- --export --recheck-alive` (`--limit 1000`처럼 개수 제한 가능)
2. 파일을 하나씩 첨부하거나 붙여 넣고, 아래 글을 함께 보내세요. 웹 검색이 되는 AI(검색 켜기)가 훨씬 정확해요.
3. 받은 답을 `ended-result-part1.csv` 처럼 저장해 `npm run import:status -- server/data/status-review/ended-result-part1.csv` 로 반영합니다.
   (또는 채팅으로 저에게 주세요)

---

첨부한 CSV는 IGDB 게임 목록이야. (id, 영문 이름, 출시 연도, 플랫폼, 게임 모드, 업체)
각 게임이 **오늘 기준 서비스가 종료됐는지** 판단해 줘. (오늘 날짜를 기준으로, 2025~2026년에 발표된 **최근 종료 공지**도 꼭 웹 검색으로 확인해 줘. 예: 넥슨 크레이지 아케이드 2026-08-13 종료)

- `ended`: 게임 자체를 새로 플레이할 수 없게 됨을 확인함
  - 온라인 게임(MMO, 온라인 캐주얼 게임, 라이브 서비스 모바일 게임 등)의 서비스·서버 종료
  - 또는 모든 스토어에서 내려가 구하거나 플레이할 수 없음
  - 멀티플레이 서버만 닫히고 싱글은 여전히 할 수 있으면 ended 가 아님
- `released`: 지금도 플레이하거나 구할 수 있음을 확인함
- `unknown`: 확실하지 않음 (모르면 반드시 unknown, 이름만 보고 추측하지 말 것)

국가별로 서비스가 다르면 **한국 서비스 기준**으로 판단해 줘.

답은 **CSV 한 덩어리로만** 줘. 다른 설명은 쓰지 마.
열: `id,status,evidence`
- id는 첨부한 그대로(예: igdb-1234)
- status는 ended / released / unknown 중 하나
- evidence는 판단 근거(확인한 페이지 주소나 짧은 근거). 모르면 비워 둬

예:
```
id,status,evidence
igdb-1234,ended,https://example.com/notice (2023-06 서비스 종료 공지)
igdb-5678,released,https://store.steampowered.com/app/...
igdb-9012,unknown,
```
