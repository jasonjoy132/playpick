import { Link } from '../lib/router.jsx';

export function DemoStorePage({ id }) {
  return (
    <section className="state demo-store" data-testid="demo-store">
      <span className="tag tag-demo">데모 구매처</span>
      <h1>외부 구매처 이동 (데모)</h1>
      <p>
        실제 서비스에서는 이 위치에서 게임의 외부 구매처 페이지가 열립니다.
        <br />
        현재는 데모 데이터로 동작 중이므로 실제 판매 페이지가 아닙니다.
      </p>
      <p className="muted">게임 ID: {id}</p>
      <Link to={`/games/${encodeURIComponent(id)}`} className="btn btn-ghost">
        게임 상세로 돌아가기
      </Link>
    </section>
  );
}
