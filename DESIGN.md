# PlayPick 디자인 가이드

바탕: **Flip7 Card Game** DESIGN.md (designmd.ai/yiujc/flip7-card-game, MIT 라이선스).
원본은 밝은 색만 정의되어 있어 **다크 모드 색은 PlayPick에서 따로 정함**. 원본의 rpx 값은 px로 절반 환산.

실제 값은 `client/src/styles.css` 맨 위 `:root`(라이트)·`:root[data-theme="dark"]`(다크) 토큰이 기준.
새 화면을 만들 때 색을 직접 쓰지 말고 아래 토큰을 쓸 것(어두운 사진·히어로 위의 흰 글자처럼 두 모드에서 같은 경우만 예외).

## 색

| 역할 | 토큰 | 라이트 | 다크 |
|---|---|---|---|
| 배경 | `--bg` | #EFF8F7 (Surface Base) | #0E1A1B |
| 카드 | `--surface-2` | #FFFFFF | #182C2E |
| 옅은 면(바닥글 등) | `--surface` | #F6FBFA | #132324 |
| 입력칸·칩 | `--field` | #FFFFFF | #11201F |
| 글자 / 보조 글자 | `--text` / `--muted` | #1B2B2E / #557173 | #E3F1EF / #9BB6B3 |
| 선 | `--line` / `--line-strong` | #D3E8E5 / #9FD3CF | #26413F / #3C6662 |
| 주색(청록) | `--primary` | #1E8C86 (Primary Dark — 흰 글자 대비) | #3CC4BD (Primary Light, 글자는 어둡게 `--primary-ink`) |
| 주색 밝은 강조 | `--primary-bright` | #2BA8A2 (Primary) | #3CC4BD |
| 금색 CTA | `--gold`, `--gold-cta` | #FFD23F, 그라데이션 #FFE47A→#FFD23F→#F2C200 | 같음 |
| 산호(보조 강조) | `--coral` | #EF6C4A | #FF8A6A |
| 크림(금색 옅은 면) | `--gold-soft` | #FFF8E7 (Cream) | #2C2610 |
| 맞음 / 안 맞음 / 정보 없음 | `--ok` / `--bad` / `--unk` (+ `-soft`, `-line`) | 초록 / 빨강 / 노랑 | 밝게 조정 |
| AI 추정 | `--ai-soft` / `--ai-ink` | 보라 | 밝은 보라 |
| 별점 | `--star` / `--star-empty` | #F2B705 / #D6E2E1 | #FFD23F / #36504E |

헤더·로그인 창은 청록 그라데이션(`--header-bg`, `--panel-bg`), 다크에서는 짙은 청록.

## 모양

- 둥글기: `--radius-sm` 12px · `--radius` 16px · `--radius-lg` 24px(캐러셀·상세 히어로·창) · 버튼·칩·배지는 알약형(999px)
- 그림자: 회색 대신 **청록빛 그림자**(`--shadow-card`, `--shadow`), 강조 버튼은 색 빛남(`--glow-teal`, `--glow-gold`)
- 금색 CTA(`.btn-gold`): 위가 밝은 그라데이션 + 안쪽 윗선 광택
- 카드 강조: 왼쪽 6px 색 막대(게임 찾기 안내), 섹션 제목 앞 청록 막대
- 구분선: 표·평점 요약은 점선
- 제목은 굵게(800), 애니메이션 0.5초 이하, `prefers-reduced-motion`이면 끔
- 글꼴: Pretendard(없으면 시스템 한글 글꼴)

## 다크 모드

- `<html data-theme="light|dark">`. `client/index.html`의 짧은 스크립트가 **그리기 전에** 정함(깜빡임 방지):
  저장한 값(`localStorage.theme`) → 없으면 기기 설정(`prefers-color-scheme`)
- 헤더 해·달 버튼(`ThemeToggle.jsx`)으로 바꾸면 저장. 직접 고르기 전에는 기기 설정이 바뀌면 따라감
- 테스트: `e2e/theme.test.js`
