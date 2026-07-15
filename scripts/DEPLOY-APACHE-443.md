# Inside Sales — HTTPS na 443 (somente este app)

O Inside Sales passa a ser **o único serviço** em:

**https://intc02.int.intcloud.com.br/**

---

## 1. Apache — substituir o site na 443

```bash
sudo a2enmod proxy proxy_http ssl headers

cd ~/inside
git pull

# Copiar vhost
sudo cp scripts/apache-insidesales-443.conf /etc/apache2/sites-available/insidesales-443.conf

# Ver sites ativos hoje
ls /etc/apache2/sites-enabled/

# Desativar o site ANTIGO (troque pelo nome real do arquivo)
sudo a2dissite 000-default-le-ssl.conf
# ou: sudo a2dissite default-ssl.conf
# ou o arquivo que aparecer em sites-enabled

# Ativar Inside Sales
sudo a2ensite insidesales-443

sudo apache2ctl configtest
sudo systemctl reload apache2
```

---

## 2. `.env` na VM

```env
NEXT_PUBLIC_APP_URL=https://intc02.int.intcloud.com.br

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

**Não** use `NEXT_PUBLIC_BASE_PATH` (deixe vazio ou remova).

---

## 3. Rebuild

```bash
cd ~/inside
./scripts/deploy-vm.sh ~/inside
pm2 stop ngrok-bitrix   # opcional
```

---

## 4. Testar

```bash
curl -I https://intc02.int.intcloud.com.br/
pm2 logs insidesales --lines 20
```

Bitrix (iframe): `https://intc02.int.intcloud.com.br/`
