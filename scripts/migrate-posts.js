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
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers
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

const posts = [
  {
    title: '三体中的那些金句',
    slug: 'san-ti-jin-ju',
    excerpt: '收录了三体三部曲中的经典语句，从仰望星空到给岁月以文明。',
    content: `# 三体中的那些金句

## 《三体Ⅰ·地球往事》

- "我们都是阴沟里的虫子，但还总是得有人仰望星空。"
- "在中国，任何超脱飞扬的思想都会砰然坠地的，现实的引力太沉重了。"
- "你的无畏来源于无知。" —— 杨冬
- "不要回答！！不要回答！！不要回答！！" —— 三体世界的和平主义者
- "把人类看做虫子的三体人似乎忘记了一个事实：虫子从来没有被战胜过。" —— 史强
- "邪乎到家必有鬼。" —— 史强

## 《三体Ⅱ·黑暗森林》

- "妈妈，我将变成一只萤火虫。"
- "不理睬是最大的轻蔑。" —— 罗辑
- "光锥之内就是命运。"
- "前进！前进！！不择手段地前进！！！" —— 维德
- "不要返航，这里不是家！" —— 青铜时代号
- "毁灭你，与你有何相干？"
- "只送大脑。" —— 维德
- "傻孩子们，快跑啊！" —— 丁仪
- "来了，爱了，给了她一颗星星，走了。" —— 云天明的墓志铭
- "这是计划的一部分。" —— 罗辑
- "自然选择号，前进四！" —— 章北海

## 《三体Ⅲ·死神永生》

- "给岁月以文明，而不是给文明以岁月。"
- "失去人性，失去很多；失去兽性，失去一切。" —— 维德
- "弱小和无知不是生存的障碍，傲慢才是。" —— 白Ice
- "把字刻在石头上。"
- "宇宙很大，生活更大，也许以后我们还有缘相见。"
- "死亡是唯一一座永远亮着的灯塔……一切都会逝去，只有死神永生。"
- "给我一块二向箔，清理用。" —— 歌者
- "小女孩，你看，我遵守了诺言。" —— 维德
- "没有救世的能力不是你的错，但给世界以希望后又打碎它就是一种不可饶恕的罪恶了。"`,
    tags: '["三体","读书","金句"]',
    status: 'published'
  },
  {
    title: 'SAS硬盘使用SATA线缆无法启动的解决',
    slug: 'sas-sata-power-issue',
    excerpt: 'SAS硬盘搭配SATA转接线后无法通电？原来是3.3V PWDIS功能在作怪。',
    content: `# SAS硬盘使用SATA线缆无法启动的解决

买了一块SAS机械硬盘，搭配手上的阵列卡和SAS转SATA转换接口使用。接上之后发现无论如何都无法通电。

## 原因

SATA 3.3 规范引入了"电源禁用"（PWDIS）功能，利用了SATA接口中 Pin3 的 3.3V 针脚作为断电信号。SAS硬盘兼容这个特性，当检测到 Pin3 有 3.3V 供电时，会触发PWDIS导致硬盘持续处于断电状态。

## 解决方案

需要对SATA供电线缆进行物理改造，**屏蔽掉Pin3的3.3V供电**。可以用胶带或剪断对应线缆来实现。

改造后SAS硬盘即可正常通电使用。`,
    tags: '["硬件","SAS","踩坑"]',
    status: 'published'
  },
  {
    title: 'Jenkins Webhook 构建403问题',
    slug: 'jenkins-webhook-403',
    excerpt: 'Gitea的webhook触发Jenkins构建返回403？用API Token + Base64认证解决。',
    content: `# Jenkins Webhook 构建403问题

使用 Jenkins 的 Webhook 进行自动构建时遇到 403 错误，记录一下解决方法。

## 解决步骤

1. 在 Jenkins 中导航到 **用户 → 安全 → API Token**，创建一个 API Token
2. 在 Gitea 的 Webhook 配置中，设置授权标头：

\`\`\`
Basic Base64(用户名:token)
\`\`\`

即把 \`用户名:token\` 进行 Base64 编码，然后作为 Authorization Header 填入 webhook 配置。

这样 Gitea 触发 Jenkins 构建时就会携带正确的认证信息，403 问题就解决了。`,
    tags: '["Jenkins","CI/CD","踩坑"]',
    status: 'published'
  },
  {
    title: 'tun2proxy：将代理转为全局TUN隧道',
    slug: 'tun2proxy-guide',
    excerpt: 'tun2proxy 可以将 SOCKS/HTTP 代理转为 TUN 隧道，实现全局透明代理。',
    content: `# tun2proxy：将代理转为全局TUN隧道

项目地址：https://github.com/tun2proxy/tun2proxy

## 基本用法

\`\`\`bash
# 创建 tun 网卡
ip tuntap add name tun0 mode tun
ip link set tun0 up

# 绕过代理服务器自身的流量
ip route add 服务器IP via 本地网关 dev 本地网卡

# 启动 tun2proxy
./tun2proxy-bin --tun tun0 --proxy "socks5://1.2.3.4:1080"
\`\`\`

## 配置 systemd 服务

\`\`\`ini
[Unit]
Description=tun2proxy
After=network.target

[Service]
ExecStart=/root/tun2proxy-bin --tun tun0 --proxy "socks5://1.2.3.4:1080"
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
\`\`\`

## 测试

\`\`\`bash
curl -o /dev/null -s -w "Speed: %{speed_download} bytes/sec\\n" \\
  http://ftp.us.debian.org/debian/dists/Debian12.10/main/installer-amd64/20230607/images/cdrom/xen/initrd.gz \\
  --interface tun0
\`\`\`

类似项目：https://github.com/heiher/hev-socks5-tunnel`,
    tags: '["代理","Linux","网络"]',
    status: 'published'
  },
  {
    title: 'curl 下载文件测速',
    slug: 'curl-download-speed-test',
    excerpt: '用 curl 命令测试下载速度，一行搞定。',
    content: `# curl 下载文件测速

用 curl 测试下载速度，不用装额外工具：

\`\`\`bash
curl -o /dev/null -s -w "Download speed: %{speed_download} bytes/sec\\n" \\
  https://example.com/large-file.zip
\`\`\`

常用参数：
- \`-o /dev/null\` — 下载内容丢弃，不写入磁盘
- \`-s\` — 静默模式，不显示进度条
- \`-w\` — 自定义输出格式

也可以指定网卡测速：

\`\`\`bash
curl -o /dev/null -s -w "%{speed_download}" \\
  https://speed.cloudflare.com/__down?bytes=10485760 \\
  --interface tun0
\`\`\``,
    tags: '["Linux","curl","网络"]',
    status: 'published'
  },
  {
    title: 'Chrome翻译完美解决：代理谷歌翻译+hosts',
    slug: 'chrome-translate-proxy',
    excerpt: '通过反向代理 translate.googleapis.com 并配置 hosts，让 Chrome 翻译恢复正常。',
    content: `# Chrome翻译完美解决：代理谷歌翻译+hosts

Chrome 内置翻译功能依赖 \`translate.googleapis.com\`，在国内无法直接访问。通过在服务器上搭建反向代理并修改 hosts 即可解决。

## 方案一：sniproxy（推荐）

不需要自签证书，但需独立占用443端口：

\`\`\`bash
apt-get install -y sniproxy
# 在 /etc/sniproxy.conf 的 table https_hosts 部分添加：
# translate.googleapis.com$  *
sniproxy -c /etc/sniproxy.conf
\`\`\`

## 方案二：nginx + 自签证书

\`\`\`nginx
server {
    listen 443 ssl http2;
    server_name translate.googleapis.com;
    ssl_certificate /home/translate.googleapis.com.pem;
    ssl_certificate_key /home/translate.googleapis.com-key.pem;
    location / {
        proxy_set_header Host $http_host;
        proxy_pass https://translate.googleapis.com;
    }
}
\`\`\`

## 配置 hosts

在 hosts 文件中添加：

\`\`\`
你的服务器IP translate.googleapis.com
\`\`\`

## 验证

浏览器访问 \`https://translate.googleapis.com/translate_static/css/translateelement.css\`，能正常加载即表示代理成功。`,
    tags: '["Chrome","代理","Nginx"]',
    status: 'published'
  },
  {
    title: 'Docker 批量操作命令速查',
    slug: 'docker-batch-commands',
    excerpt: '停止、删除所有容器和镜像的常用 Docker 命令速查。',
    content: `# Docker 批量操作命令速查

日常使用 Docker 经常需要批量操作，记录一些常用命令：

\`\`\`bash
# 列出所有容器 ID
docker ps -aq

# 停止所有容器
docker stop $(docker ps -aq)

# 删除所有容器
docker rm $(docker ps -aq)

# 删除所有镜像
docker rmi $(docker images -q)

# 删除所有不使用的镜像
docker image prune -f -a

# 删除所有停止的容器
docker container prune
\`\`\`

## 容器与主机之间复制文件

\`\`\`bash
# 容器 -> 主机
docker cp mycontainer:/opt/file.txt /opt/local/

# 主机 -> 容器
docker cp /opt/local/file.txt mycontainer:/opt/
\`\`\``,
    tags: '["Docker","Linux","速查"]',
    status: 'published'
  },
  {
    title: 'Nginx 代理 Docker Hub',
    slug: 'nginx-proxy-dockerhub',
    excerpt: '用 Nginx 搭建 Docker Hub 的无缓存代理镜像站，解决拉取镜像慢的问题。',
    content: `# Nginx 代理 Docker Hub

用 Nginx 对 Docker Hub 官方 registry 进行反向代理，相当于搭建一个无缓存的镜像站。

## Nginx 配置

\`\`\`nginx
location / {
    client_max_body_size 1024M;
    proxy_pass https://registry-1.docker.io:443;
    proxy_set_header Authorization $http_authorization;
    proxy_pass_header Authorization;
    proxy_redirect https://registry-1.docker.io $scheme://$http_host;
}
\`\`\`

配置完成后，访问对应域名如果得到的响应和 \`https://registry-1.docker.io\` 一样，就表示代理成功。

然后修改 Docker 的 \`daemon.json\`，添加 \`registry-mirrors\` 指向你的代理地址即可。`,
    tags: '["Nginx","Docker","运维"]',
    status: 'published'
  },
  {
    title: 'Nginx 解决 "no resolver defined to resolve" 错误',
    slug: 'nginx-no-resolver',
    excerpt: 'Nginx 反向代理使用域名时报错 no resolver defined？加一行 resolver 指令即可。',
    content: `# Nginx 解决 "no resolver defined to resolve" 错误

在 Nginx 0.6.18 以后的版本中，如果 \`proxy_pass\` 使用了变量来构造地址，会报错：

> no resolver defined to resolve

原因是 Nginx 要求使用变量时必须通过 \`resolver\` 指令指定 DNS 服务器。

## 解决方法

在 \`http{}\` 块或 \`location{}\` 块中添加：

\`\`\`nginx
location /api/ {
    resolver 8.8.8.8;
    proxy_pass http://backend.example.com$request_uri;
}
\`\`\`

也可以使用其他 DNS 服务器，比如 \`114.114.114.114\` 或自建的 DNS。`,
    tags: '["Nginx","踩坑","运维"]',
    status: 'published'
  },
  {
    title: 'axios 使用 FormData 上传文件',
    slug: 'axios-formdata-upload',
    excerpt: '用 axios 以 FormData 方式上传文件的代码示例。',
    content: `# axios 使用 FormData 上传文件

前端使用 axios 以表单方式上传文件：

## HTML

\`\`\`html
<input id="name" name="name"/>
<input id="age" name="age"/>
<input id="file" type="file" name="file" multiple>
\`\`\`

## JavaScript

\`\`\`javascript
let forms = new FormData()

forms.append('name', document.getElementById('name').value)
forms.append('age', document.getElementById('age').value)

let files = document.getElementById('file').files

// 上传多个文件
Array.from(files).forEach(item => {
    forms.append('file', item)
})

const options = {
  method: 'POST',
  data: forms,
  url: '/api/upload',
};
axios(options);
\`\`\`

注意：使用 FormData 时**不需要**手动设置 \`Content-Type\`，axios 会自动设置为 \`multipart/form-data\` 并生成正确的 boundary。`,
    tags: '["JavaScript","axios","前端"]',
    status: 'published'
  }
];

function randomDate() {
  const start = new Date('2025-11-12').getTime();
  const end = new Date('2026-05-10').getTime();
  const d = new Date(start + Math.random() * (end - start));
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function main() {
  if (!PASSWORD) {
    console.error('ADMIN_PASSWORD not set in .env');
    process.exit(1);
  }

  // Login
  const loginRes = await request('POST', '/admin/login', { password: PASSWORD });
  console.log('Login:', loginRes.status, loginRes.cookies ? 'OK' : 'FAIL');
  if (!loginRes.cookies) {
    console.error('Login failed. Check ADMIN_PASSWORD.');
    process.exit(1);
  }
  const cookies = loginRes.cookies;

  for (const post of posts) {
    const createdAt = randomDate();
    const body = {
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      content: post.content,
      tags: post.tags,
      status: post.status,
      created_at: createdAt,
      updated_at: createdAt
    };
    const res = await request('POST', '/api/posts', body, cookies);
    try {
      const parsed = JSON.parse(res.data);
      console.log(`[${res.status}] ${post.title} -> ${parsed.slug || parsed.error}`);
    } catch (e) {
      console.log(`[${res.status}] ${post.title} -> ${res.data.slice(0, 100)}`);
    }
  }
  console.log('Done!');
}

main().catch(console.error);
