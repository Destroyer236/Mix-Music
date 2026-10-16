declare module 'qrcode' {
  export function toDataURL(value: string, options?: { width?: number, margin?: number, errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }): Promise<string>
}
