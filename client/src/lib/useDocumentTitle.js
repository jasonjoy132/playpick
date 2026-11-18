// 화면마다 브라우저 탭·공유 제목을 다르게 ('인기 게임 · 플레이픽')
import { useEffect } from 'react';

export const SITE_TITLE = '플레이픽 PlayPick · 맞춤형 게임 큐레이션';

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · 플레이픽` : SITE_TITLE;
    // 화면을 떠나면 기본 제목으로(제목을 정하지 않는 화면에 이전 제목이 남지 않게)
    return () => {
      document.title = SITE_TITLE;
    };
  }, [title]);
}
