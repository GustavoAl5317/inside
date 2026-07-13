# Inside Sales — HTTPS na 443 (Apache + `/inside/`)

O serviço que **já usa a 443 continua igual**. O Inside Sales fica em:

**https://intc02.int.intcloud.com.br/inside/**

---

## 1. Apache — adicionar proxy (na VM)

```bash
sudo a2enmod proxy proxy_http ssl headers
```

Abra o site HTTPS que já existe:

```bash
ls /etc/apache2/sites-enabled/
sudo nano /etc/apache2/sites-enabled/SEU-SITE-443.conf
```

Dentro do bloco `<VirtualHost *:443>`, **antes** de `</VirtualHost>`, cole o conteúdo de `scripts/apache-inside-443.conf`.

Teste e recarregue:

```bash
sudo apache2ctl configtest
sudo systemctl reload apache2
```

---

## 2. App — `.env` na VM (`~/inside/.env`)

```env
NEXT_PUBLIC_BASE_PATH=/inside
NEXT_PUBLIC_APP_URL=https://intc02.int.intcloud.com.br/inside

NODE_ENV=production
DATABASE_URL=...
OMIE_APP_KEY_1=...
OMIE_APP_SECRET_1=...
OMIE_APP_KEY_2=...
OMIE_APP_SECRET_2=...
BITRIX_LIST_FAMILY_ID=65
BITRIX_LIST_PAYMENT_ID=67
APP_SESSION_SECRET=...
```

---

## 3. Atualizar código e rebuild

```bash
cd ~/inside
git pull
chmod +x scripts/deploy-vm.sh
./scripts/deploy-vm.sh ~/inside
```

---

## 4. Testar

```bash
curl -I https://intc02.int.intcloud.com.br/inside/
pm2 logs insidesales --lines 20
```

Navegador: **https://intc02.int.intcloud.com.br/inside/**

Bitrix (iframe): mesma URL.

---

## Observações

- O app continua na porta **3000** (PM2); só o Apache expõe **HTTPS na 443**.
- Não use `https://...:3000` — use sempre `/inside/` na 443.
- Pare o ngrok na 3000 se não precisar mais: `pm2 stop ngrok-bitrix`
