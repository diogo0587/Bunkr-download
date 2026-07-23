import fetch from 'node-fetch';

async function test() {
  try {
    const res = await fetch('https://mlk-bk.cdn.gigachad-cdn.ru/69d21220-e2fa-42ca-a570-d293198ee241.mp4', {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://bunkr.cr/'
      }
    });
    console.log('Status:', res.status);
    console.log('Headers:', res.headers.raw());
  } catch (e) {
    console.error('Error:', e.message);
  }
}
test();
