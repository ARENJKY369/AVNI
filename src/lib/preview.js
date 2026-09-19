// Can the browser actually render this file?
//
// A dropped .tif reports `image/tiff`, which passes every MIME check and then
// fails to decode — the viewer would end up showing a broken image while the
// sidebar claimed a new scene was registered. So we ask the decoder.

export async function canRenderPreview(file) {
  if (!file || !(file.type || '').startsWith('image/')) return false;
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      bitmap.close?.();
      return true;
    } catch {
      return false;
    }
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(true);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };
    img.src = url;
  });
}
