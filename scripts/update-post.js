const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE = 'http://localhost:3000';
const PASSWORD = process.env.ADMIN_PASSWORD || '';

function request(method, urlPath, body, cookies) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const headers = {};
    if (cookies) headers['Cookie'] = cookies;
    if (body) {
      const json = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(json);
    }
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname, method, headers
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const setCookies = res.headers['set-cookie'] || [];
        const cookieStr = setCookies.map(c => c.split(';')[0]).join('; ');
        resolve({ status: res.statusCode, data, cookies: cookieStr });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  const loginRes = await request('POST', '/admin/login', { password: PASSWORD });
  const cookies = loginRes.cookies;

  const body = {
    title: '余华经典作品摘录',
    slug: 'yu-hua-classic',
    excerpt: '余华笔下的生死与荒诞，冷静叙述中藏着最深的悲悯。',
    content: `# 余华经典作品摘录

## 《活着》

人是为活着本身而活着的，而不是为了活着之外的任何事物所活着。

少年去游荡，中年想掘藏，老年做和尚。

做人不能忘记四条：话不要说错，床不要睡错，门槛不要踏错，口袋不要摸错。

人只要活得高兴，穷也不怕。

这辈子想起来也是很快就过来了，过得平平常常，我爹指望我光耀祖宗，他算是看错人了。我啊，就是这样的命。年轻时靠着祖上留下的钱风光了一阵子，往后就越过越落魄了，这样反倒好，看看我身边的人，龙二和春生，他们也只是风光了一阵子，到头来命都丢了。做人还是平常点好，争这个争那个，争来争去赔了自己的命。

## 《许三观卖血记》

一个人命再大，要是自己想死，那就怎么也活不了。

人啊，活着时受了再多的苦，到了快死的时候也会想个法子来宽慰自己。

这就叫屌毛出得比眉毛晚，长得倒比眉毛长。

他的泪水在他脸上纵横交错地流，就像雨水打在窗玻璃上，就像裂缝爬上快要破碎的碗，就像蓬勃生长出去的树枝，就像渠水流进了田地，就像街道布满了城镇，泪水在他脸上织成了一张网。

## 《兄弟》

我想无论是写作还是人生，正确的出发都是走进窄门。不要被宽阔的大门所迷惑，那里面的路没有多长。

我们走在路上，走在人生的大路上，我们的前方是坟地，可是我们还是要走下去，因为我们的身后也是坟地。

## 《在细雨中呼喊》

我不再装模作样地拥有很多朋友，而是回到了孤独之中，以真正的我开始了独自的生活。

当人们无法选择自己的未来时，就会珍惜自己选择过去的权利。回忆的动人之处就在于可以重新选择。

## 《文城》

哭泣是因为希望尚存，绝望反而让她平静。

人往往在最不设防的时刻，才会露出最真实的面目。`,
    tags: '["余华","读书","文学"]',
    status: 'published'
  };

  const res = await request('PUT', '/api/posts/4', body, cookies);
  const parsed = JSON.parse(res.data);
  console.log(`[${res.status}] ${parsed.title} -> ${parsed.slug}`);
}

main().catch(console.error);
