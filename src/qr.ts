import QRCode from 'qrcode';
import { addImageAsset } from './assets';
import { useEditor } from './store';

/** Generate a QR code for a link and drop it on the canvas as an image layer. */
export async function addQrCode(text: string): Promise<void> {
  const canvas = document.createElement('canvas');
  await QRCode.toCanvas(canvas, text, {
    margin: 2,
    width: 720,
    color: { dark: '#000000ff', light: '#ffffffff' },
  });
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('QR encode failed'))), 'image/png'),
  );
  const asset = await addImageAsset(new File([blob], 'qr.png', { type: 'image/png' }));
  useEditor.getState().addImageLayer(asset.id);
}

/** Prompt for a link, then add a QR for it. */
export async function promptAddQrCode(): Promise<void> {
  const text = window.prompt('Link for the QR code:', 'https://');
  if (!text) return;
  try {
    await addQrCode(text);
  } catch (err) {
    console.error(err);
    alert('Could not generate that QR code.');
  }
}
