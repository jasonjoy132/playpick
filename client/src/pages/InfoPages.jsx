// 개인정보처리방침 · 이용약관 · 데이터 출처 안내
import { Link } from '../lib/router.jsx';

const EFFECTIVE = '2026년 11월 5일';
// 문의 연락처: 정해지면 이메일 주소를 넣으세요 (예: 'help@example.com'). 비어 있으면 '준비 중'으로 표시
const CONTACT_EMAIL = 'jason040215@ajou.ac.kr';

function Contact() {
  return CONTACT_EMAIL ? <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> : <span className="muted">연락처 준비 중</span>;
}

function Doc({ title, testId, children }) {
  return (
    <article className="doc-page" data-testid={testId}>
      <h1>{title}</h1>
      {children}
      <p className="doc-links">
        <Link to="/terms">이용약관</Link> · <Link to="/privacy">개인정보처리방침</Link> · <Link to="/sources">데이터 출처</Link>
      </p>
    </article>
  );
}

export function PrivacyPage() {
  return (
    <Doc title="개인정보처리방침" testId="privacy-page">
      <p className="muted">시행일: {EFFECTIVE}</p>
      <p>플레이픽(PlayPick, 이하 '사이트')은 회원 기능에 꼭 필요한 정보만 받고, 아래처럼 처리합니다.</p>

      <h2>1. 받는 정보</h2>
      <ul>
        <li>
          <b>가입할 때(필수):</b> 아이디, 비밀번호, 닉네임, 이메일. 비밀번호는 되돌릴 수 없는 방식(scrypt 해시)으로 바꿔 저장하며, 원래 비밀번호는 저장하지 않습니다.
        </li>
        <li>
          <b>이용하면서 생기는 정보:</b> 프로필 사진(올린 경우), 찜 목록, 별점·리뷰, 최근 본 게임, 대표 칭호, 게임·사진·정보 수정·서비스 종료 제보 내용(올린 사진과 출처 주소 포함), 리뷰 신고 내용
        </li>
        <li>
          <b>로그인 유지:</b> 로그인 상태를 유지하는 쿠키 1개(14일). 광고·분석용 쿠키는 쓰지 않습니다.
        </li>
        <li>
          <b>요청 제한:</b> 무차별 로그인 시도를 막으려고 접속 IP 주소를 서버 메모리에서 잠시(최대 1시간) 사용하며, DB에 저장하지 않습니다.
        </li>
      </ul>

      <h2>2. 쓰는 목적</h2>
      <ul>
        <li>회원 확인과 로그인 유지</li>
        <li>아이디 찾기·비밀번호 재설정 메일 발송(재설정 링크는 30분 동안 한 번만 사용 가능)</li>
        <li>찜·별점·리뷰·최근 본 게임·제보·칭호 기능 제공</li>
        <li>제보·신고 검토와 부정 이용 방지</li>
      </ul>

      <h2>3. 다른 사람에게 보이는 정보</h2>
      <p>닉네임, 프로필 사진, 대표 칭호, 리뷰(별점·내용)는 다른 이용자에게 보입니다. 아이디·이메일은 보이지 않습니다.</p>

      <h2>4. 보관 기간</h2>
      <ul>
        <li>회원 정보와 이용 기록(찜·리뷰·알림 등): 회원 탈퇴 시 바로 삭제</li>
        <li>관리자가 승인한 제보(게임·표지 사진·정보 수정): 게임 정보가 되므로 탈퇴 후에도 작성자 정보 없이 남습니다</li>
        <li>로그인 쿠키·세션: 14일 또는 로그아웃할 때까지</li>
        <li>비밀번호 재설정 링크: 30분</li>
      </ul>

      <h2>5. 제3자 제공과 처리 위탁</h2>
      <p>개인정보를 다른 곳에 팔거나 제공하지 않습니다. 다만 다음 일은 외부 서비스에 맡깁니다.</p>
      <ul>
        <li>
          <b>Vercel:</b> 사이트 호스팅과 서버 실행(요청을 처리하는 동안 접속 IP 등 접속 기록이 거쳐 감)
        </li>
        <li>
          <b>Turso:</b> 회원 DB와 업로드한 사진 저장(위 1번의 회원·이용 정보)
        </li>
        <li>
          <b>Brevo:</b> 아이디 찾기·비밀번호 재설정 메일 발송(이메일 주소, 닉네임)
        </li>
      </ul>

      <h2>6. 이용자의 권리</h2>
      <ul>
        <li>마이페이지에서 프로필 사진·대표 칭호를 바꾸고, 찜과 리뷰를 지울 수 있습니다.</li>
        <li>
          마이페이지 → 회원 탈퇴에서 계정과 관련 정보를 직접 삭제할 수 있습니다. 정보 열람·정정은 아래 문의처로 요청해 주세요: <Contact />
        </li>
      </ul>

      <h2>7. 안전 조치</h2>
      <p>비밀번호는 해시로만 저장하고, 로그인 쿠키는 자바스크립트로 읽을 수 없게(HttpOnly) 설정합니다. API 키 등 비밀 값은 서버에만 둡니다.</p>

      <h2>8. 문의</h2>
      <p>
        개인정보 관련 문의: <Contact />
      </p>
      <p className="muted">이 사이트는 대학 수업 과제로 만든 비상업 사이트입니다.</p>
    </Doc>
  );
}

export function TermsPage() {
  return (
    <Doc title="이용약관" testId="terms-page">
      <p className="muted">시행일: {EFFECTIVE}</p>

      <h2>1. 목적</h2>
      <p>이 약관은 플레이픽(PlayPick, 이하 '사이트')을 이용하는 조건을 정합니다. 사이트는 대학 수업 과제로 만든 비상업 서비스입니다.</p>

      <h2>2. 회원가입</h2>
      <ul>
        <li>가입하면 이 약관과 <Link to="/privacy">개인정보처리방침</Link>에 동의한 것으로 봅니다.</li>
        <li>다른 사람의 이메일·정보로 가입하면 안 되며, 계정 관리 책임은 본인에게 있습니다.</li>
      </ul>

      <h2>3. 게시물(리뷰·제보·사진)</h2>
      <ul>
        <li>게시물의 권리는 작성자에게 있습니다. 작성자는 사이트가 그 게시물을 사이트 안에서 보여 주는 것을 허락합니다.</li>
        <li>사진 제보는 출처 주소를 꼭 적어야 하며, 다른 사람의 저작권을 침해하는 사진은 올리면 안 됩니다.</li>
        <li>욕설·비방·광고·개인정보 노출·거짓 정보가 담긴 게시물은 관리자가 숨기거나 거절할 수 있습니다.</li>
        <li>제보는 관리자가 확인한 뒤에 반영되며, 반영된 정보는 '사용자 제보 · 관리자 확인'으로 표시됩니다.</li>
      </ul>

      <h2>4. 게임 정보에 대해</h2>
      <ul>
        <li>
          게임 정보는 외부 데이터에서 가져옵니다(<Link to="/sources">데이터 출처</Link>). 확인되지 않은 정보는 '정보 없음'으로 표시합니다.
        </li>
        <li>'AI 추정'으로 표시된 값(추천 인원·플레이 시간·서비스 상태 등)은 AI가 추정한 것이라 틀릴 수 있습니다.</li>
        <li>구매처는 외부 사이트로 연결되며, 가격·판매 여부는 그 사이트에서 확인해 주세요. 사이트는 판매·결제를 하지 않습니다.</li>
        <li>게임 이름·이미지의 권리는 각 권리자에게 있습니다.</li>
      </ul>

      <h2>5. 금지 행동</h2>
      <ul>
        <li>자동 프로그램으로 대량 요청을 보내거나 서비스를 방해하는 행동</li>
        <li>다른 회원의 계정을 쓰거나 정보를 모으는 행동</li>
      </ul>
      <p>위반하면 게시물을 숨기거나 이용을 제한할 수 있습니다.</p>

      <h2>6. 서비스 변경·종료</h2>
      <p>과제 일정에 따라 기능이 바뀌거나 서비스가 끝날 수 있습니다. 사이트는 무료로 제공되며, 이용 중 생긴 손해에 대해 법이 허용하는 범위에서 책임지지 않습니다.</p>

      <h2>7. 문의</h2>
      <p>
        <Contact />
      </p>
    </Doc>
  );
}

const SOURCES = [
  { name: 'IGDB', url: 'https://www.igdb.com', use: '게임 이름·소개·장르·플랫폼·출시일·표지 이미지·평점(주 데이터), 이용자가 기록한 플레이 시간(3명 이상 기록한 게임만)' },
  { name: '게임물관리위원회 Open API', url: 'https://www.grac.or.kr', use: '국내 등급분류 게임 목록과 등급 정보' },
  { name: 'RAWG', url: 'https://rawg.io', use: '평균 플레이 시간 (IGDB 기록이 없을 때)' },
  { name: 'App Store (Apple 검색 API)', url: 'https://www.apple.com/kr/app-store/', use: '국내 모바일 게임 아이콘·스크린샷·App Store 링크 (이름과 개발사가 모두 일치할 때만)' },
  { name: 'DeepL', url: 'https://www.deepl.com', use: '영어 게임 소개와 검색어 번역' },
  { name: 'Google Gemini', url: 'https://ai.google.dev', use: "데이터에 없는 추천 인원·플레이 시간·서비스 상태 추정. 화면에 'AI 추정'으로 표시" },
];

export function SourcesPage() {
  return (
    <Doc title="데이터 출처" testId="sources-page">
      <p>플레이픽은 아래 서비스의 데이터를 모아 보여 줍니다. 확인되지 않은 정보는 만들지 않고 '정보 없음'으로 표시합니다.</p>
      <ul className="source-list">
        {SOURCES.map((s) => (
          <li key={s.name}>
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              {s.name}
            </a>
            <span className="muted"> — {s.use}</span>
          </li>
        ))}
      </ul>

      <h2>표시 방법</h2>
      <ul>
        <li>
          <span className="pill pill-ai">AI 추정</span> AI(Google Gemini)가 추정한 값이라 틀릴 수 있어요.
        </li>
        <li>
          <b>사용자 제보 · 관리자 확인</b> 회원이 제보하고 관리자가 확인한 정보예요.
        </li>
        <li>게임 상세 페이지의 '데이터 출처' 항목에서 그 게임 정보를 어디서 가져왔는지 볼 수 있어요.</li>
      </ul>
      <p className="muted">게임 이름·이미지·상표의 권리는 각 권리자에게 있습니다. 이 사이트는 위 서비스들과 제휴 관계가 없습니다.</p>
    </Doc>
  );
}
