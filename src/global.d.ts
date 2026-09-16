// global types

// 百度地图GL版本全局类型声明
/// <reference types="bmapgl" />

/*
 * `qrcode` is a runtime dependency with no bundled types. It is used for
 * project and apartment QR codes, which are generated in the browser so that
 * no per-code SaaS is needed and the image never leaves the device.
 * Only the one call we make is declared.
 */
declare module 'qrcode' {
  interface QrToDataUrlOptions {
    margin?: number;
    width?: number;
    scale?: number;
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    color?: { dark?: string; light?: string };
  }
  const QRCode: {
    toDataURL(text: string, options?: QrToDataUrlOptions): Promise<string>;
  };
  export default QRCode;
}
