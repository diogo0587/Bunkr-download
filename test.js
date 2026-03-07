async function test() {
  const res = await fetch('https://corsproxy.io/?https://bunkr.cr/api/vs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ slug: 'dGF1btTDFAldY' })
  });
  console.log(res.status);
  console.log(await res.text());
}
test();
