/** 프로필 이미지(없으면 닉네임 첫 글자) */
export function Avatar({ user, size = 'md', className = '' }) {
  if (!user) return null;
  return (
    <span className={`avatar avatar-${size} ${className}`} aria-hidden="true">
      {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : user.nickname.slice(0, 1)}
    </span>
  );
}
