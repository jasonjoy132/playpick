// 브라우저에서 이미지를 256px 정사각형으로 잘라 줄이기 (업로드 용량 절약)
export async function toAvatarDataUrl(file, size = 256) {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('PNG·JPG·WebP·GIF 이미지 파일을 골라 주세요.');
  if (file.size > 10 * 1024 * 1024) throw new Error('10MB 이하의 이미지를 골라 주세요.');
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close?.();
  let url = canvas.toDataURL('image/webp', 0.85);
  if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.85); // WebP 미지원 브라우저
  return url;
}

// 제보 게임 표지: 비율은 그대로, 긴 쪽 최대 800px로 줄여 JPEG/WebP (업로드 최대 1.5MB)
export async function toCoverDataUrl(file, maxSide = 800) {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('PNG·JPG·WebP·GIF 이미지 파일을 골라 주세요.');
  if (file.size > 15 * 1024 * 1024) throw new Error('15MB 이하의 이미지를 골라 주세요.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  for (const q of [0.85, 0.7, 0.55]) {
    let url = canvas.toDataURL('image/webp', q);
    if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', q);
    if (url.length * 0.75 < 1.4 * 1024 * 1024) return url;
  }
  throw new Error('이미지가 너무 커요. 더 작은 이미지를 골라 주세요.');
}
