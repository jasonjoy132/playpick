// 서버(Node.js) API 호출. API 키는 서버에만 있고 브라우저에는 전달되지 않습니다.
export class ApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(method !== 'GET' ? { 'X-Requested-With': 'playpick' } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.', { code: 'NETWORK' });
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* JSON이 아닌 응답 */
  }
  if (!res.ok) {
    throw new ApiError(data?.error?.message || `요청을 처리하지 못했습니다. (HTTP ${res.status})`, { status: res.status, code: data?.error?.code });
  }
  if (!data) throw new ApiError('서버 응답 형식이 올바르지 않습니다.', { code: 'INVALID' });
  return data;
}

const get = (p) => request('GET', p);
const gid = (id) => encodeURIComponent(id);

export const api = {
  options: () => get('/api/options'),
  featured: () => get('/api/featured'),
  search: (q) => get(`/api/search?q=${encodeURIComponent(q)}`),
  recommendations: (qs) => get(`/api/recommendations?${qs}`),
  game: (id, qs = '') => get(`/api/games/${gid(id)}${qs ? `?${qs}` : ''}`),
  /** 플레이 시간이 없는 게임: AI에게 물어 저장 (로그인 필요) */
  playtime: (id) => request('POST', `/api/games/${gid(id)}/playtime`, {}),

  browse: (kind, params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
    return get(`/api/browse/${kind}${qs ? `?${qs}` : ''}`);
  },
  memberRanking: () => get('/api/ranking/members'),

  me: () => get('/api/auth/me'),
  signup: (b) => request('POST', '/api/auth/signup', b),
  login: (b) => request('POST', '/api/auth/login', b),
  logout: () => request('POST', '/api/auth/logout', {}),
  findId: (b) => request('POST', '/api/auth/find-id', b),
  resetRequest: (b) => request('POST', '/api/auth/reset-request', b),
  resetPassword: (b) => request('POST', '/api/auth/reset', b),

  wishlist: () => get('/api/wishlist'),
  wish: (id) => request('PUT', `/api/wishlist/${gid(id)}`),
  unwish: (id) => request('DELETE', `/api/wishlist/${gid(id)}`),

  updateProfile: (b) => request('PATCH', '/api/me/profile', b),
  setAvatar: (dataUrl) => request('PUT', '/api/me/avatar', { dataUrl }),
  removeAvatar: () => request('DELETE', '/api/me/avatar'),
  changePassword: (b) => request('POST', '/api/me/password', b),
  deleteAccount: (b) => request('POST', '/api/me/delete', b),
  myReviews: () => get('/api/me/reviews'),
  recent: () => get('/api/me/recent'),
  removeRecent: (id) => request('DELETE', `/api/me/recent/${gid(id)}`),
  clearRecent: () => request('DELETE', '/api/me/recent'),

  // 뱃지·칭호
  myBadges: () => get('/api/me/badges'),
  selectBadge: (id) => request('PUT', '/api/me/badges/selected', { id }),
  markBadgesSeen: (ids) => request('POST', '/api/me/badges/seen', { ids }),

  // 알림
  notifications: () => get('/api/me/notifications'),
  notificationCount: () => get('/api/me/notifications/count'),
  readNotifications: (b) => request('POST', '/api/me/notifications/read', b),

  // 게임 제보
  submitGame: (b) => request('POST', '/api/submissions', b),
  mySubmissions: () => get('/api/me/submissions'),
  cancelSubmission: (id) => request('DELETE', `/api/me/submissions/${id}`),
  adminSubmissions: (status) => get(`/api/admin/submissions?status=${encodeURIComponent(status)}`),
  approveSubmission: (id, edits) => request('POST', `/api/admin/submissions/${id}/approve`, edits ? { edits } : {}),
  editSubmission: (id, edits) => request('POST', `/api/admin/submissions/${id}/edit`, { edits }),
  rejectSubmission: (id, reason) => request('POST', `/api/admin/submissions/${id}/reject`, { reason }),
  submitImage: (gameId, b) => request('POST', `/api/games/${encodeURIComponent(gameId)}/image-submissions`, b),
  myImageSubmissions: () => get('/api/me/image-submissions'),
  cancelImageSubmission: (id) => request('DELETE', `/api/me/image-submissions/${id}`),
  adminImageSubmissions: (status) => get(`/api/admin/image-submissions?status=${encodeURIComponent(status)}`),
  approveImageSubmission: (id) => request('POST', `/api/admin/image-submissions/${id}/approve`, {}),
  rejectImageSubmission: (id, reason) => request('POST', `/api/admin/image-submissions/${id}/reject`, { reason }),
  reportGame: (gameId, b) => request('POST', `/api/games/${encodeURIComponent(gameId)}/reports`, b),
  myReports: () => get('/api/me/reports'),
  cancelReport: (id) => request('DELETE', `/api/me/reports/${id}`),
  reportReview: (reviewId, b) => request('POST', `/api/reviews/${reviewId}/report`, b),
  adminReports: (kind, status) => get(`/api/admin/reports?kind=${encodeURIComponent(kind)}&status=${encodeURIComponent(status)}`),
  approveReport: (id, edits) => request('POST', `/api/admin/reports/${id}/approve`, edits ? { edits } : {}),
  editReport: (id, edits) => request('POST', `/api/admin/reports/${id}/edit`, { edits }),
  rejectReport: (id, reason) => request('POST', `/api/admin/reports/${id}/reject`, { reason }),
  adminReviewReports: (status) => get(`/api/admin/review-reports?status=${encodeURIComponent(status)}`),
  resolveReviewReport: (reviewId, action) => request('POST', `/api/admin/review-reports/${reviewId}/${action}`, {}),

  reviews: (id, offset = 0) => get(`/api/games/${gid(id)}/reviews?offset=${offset}`),
  saveReview: (id, b) => request('PUT', `/api/games/${gid(id)}/reviews/mine`, b),
  deleteReview: (id) => request('DELETE', `/api/games/${gid(id)}/reviews/mine`),
};
