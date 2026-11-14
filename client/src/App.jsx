import { api } from './lib/api.js';
import { useAsync } from './lib/useAsync.js';
import { matchPath, useLocation, Link } from './lib/router.jsx';
import { FinderProvider } from './lib/finder.jsx';
import { AuthProvider } from './lib/auth.jsx';
import { Layout } from './components/Layout.jsx';
import { FinderModal } from './components/FinderModal.jsx';
import { BadgeToast } from './components/BadgeToast.jsx';
import { ErrorState, Loading } from './components/Status.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { ResultsPage } from './pages/ResultsPage.jsx';
import { SearchPage } from './pages/SearchPage.jsx';
import { GamePage } from './pages/GamePage.jsx';
import { DemoStorePage } from './pages/DemoStorePage.jsx';
import { LoginPage, SignupPage, SocialSignupPage, FindIdPage, FindPasswordPage, ResetPasswordPage } from './pages/AuthPages.jsx';
import { MyPage } from './pages/MyPage.jsx';
import { PopularPage, NewPage, RankingRedirect, GenrePage, HallOfFamePage } from './pages/BrowsePages.jsx';
import { SubmitPage } from './pages/SubmitPage.jsx';
import { AdminPage } from './pages/AdminPage.jsx';
import { PrivacyPage, TermsPage, SourcesPage } from './pages/InfoPages.jsx';

export function App() {
  const { pathname } = useLocation();
  const opts = useAsync(() => api.options(), []);
  const meta = opts.data?.meta;

  let content;
  if (opts.status === 'loading') content = <Loading />;
  else if (opts.status === 'error') content = <ErrorState error={opts.error} onRetry={opts.retry} />;
  else content = route(pathname, opts.data);

  return (
    <AuthProvider>
      <FinderProvider>
        <Layout meta={meta}>{content}</Layout>
        <FinderModal options={opts.data} />
        <BadgeToast />
      </FinderProvider>
    </AuthProvider>
  );
}

function route(pathname, options) {
  let m;
  if (pathname === '/') return <HomePage options={options} />;
  if (pathname === '/results') return <ResultsPage options={options} />;
  if (pathname === '/search') return <SearchPage options={options} />;
  if (pathname === '/popular') return <PopularPage options={options} />;
  if (pathname === '/new') return <NewPage options={options} />;
  if (pathname === '/ranking') return <RankingRedirect />; // 예전 '평점 랭킹' → 인기 게임(평점 높은 순)
  if (pathname === '/hall-of-fame') return <HallOfFamePage />;
  if (pathname === '/genres') return <GenrePage options={options} />;
  if (pathname === '/submit') return <SubmitPage options={options} />;
  if (pathname === '/admin') return <AdminPage options={options} />;
  if (pathname === '/privacy') return <PrivacyPage />;
  if (pathname === '/terms') return <TermsPage />;
  if (pathname === '/sources') return <SourcesPage />;
  if (pathname === '/login') return <LoginPage />;
  if (pathname === '/signup') return <SignupPage />;
  if (pathname === '/signup/social') return <SocialSignupPage />;
  if (pathname === '/find-id') return <FindIdPage />;
  if (pathname === '/find-password') return <FindPasswordPage />;
  if (pathname === '/reset-password') return <ResetPasswordPage />;
  if (pathname === '/wishlist') return <MyPage section="wishlist" options={options} />;
  if (pathname === '/mypage') return <MyPage section="profile" options={options} />;
  m = matchPath('/mypage/:section', pathname);
  if (m) return <MyPage section={m.section} options={options} />;
  m = matchPath('/genres/:genre', pathname);
  if (m) return <GenrePage options={options} genre={m.genre} />;
  m = matchPath('/games/:id', pathname);
  if (m) return <GamePage id={m.id} options={options} />;
  m = matchPath('/demo-store/:id', pathname);
  if (m) return <DemoStorePage id={m.id} />;
  return (
    <div className="state">
      <h1>페이지를 찾을 수 없어요</h1>
      <Link to="/" className="btn btn-primary">
        홈으로
      </Link>
    </div>
  );
}
