# notlarım

iPad + Apple Pencil için yazılı ve çizimli not uygulaması. Hesap yok, sunucu yok: her şey cihazda (IndexedDB) saklanır, internet olmadan da çalışır.

Tasarım kararlarının tamamı: `docs/superpowers/specs/2026-09-25-notlarim-design.md`

## Bilgisayarda çalıştırma

Node.js 20 veya üstü gerekir.

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # birim testleri
npm run build          # dist/ klasörüne üretim çıktısı (Vercel bunu kullanır)
npm run build:single   # dist-single/index.html: tek dosyalık önizleme, sunucusuz açılır
```

Aynı Wi-Fi'daki iPad'den denemek için `npm run dev -- --host` çalıştırıp terminalde yazan `Network` adresini iPad'de aç. Not: Apple Pencil ve dokunma çalışır, ama service worker (offline) ve "Ana Ekrana Ekle" kalıcılığı sadece HTTPS'te (yani Vercel'de) tam çalışır.

## Vercel'e ücretsiz yükleme

1. Projeyi GitHub'da yeni bir repoya yükle.
2. vercel.com'da GitHub ile giriş yap, **Add New → Project** ile repoyu seç.
3. Vercel Vite'ı kendisi tanır. Ayarlar: Framework **Vite**, Build Command `npm run build`, Output Directory `dist`.
4. **Deploy**. Birkaç dakika sonra `https://<proje-adı>.vercel.app` adresin hazır.

Sonraki her `git push` otomatik yeni sürüm yayınlar. Uygulama açıkken yeni sürüm gelirse kendiliğinden yenilenmez, üstte "Yeni sürüm hazır" çıkar.

## iPad'e kurulum

1. Adresi **Safari**'de aç (Chrome'da ana ekrana ekleme aynı şekilde çalışmaz).
2. Paylaş butonu → **Ana Ekrana Ekle**.
3. Uygulamayı artık ana ekrandaki ikondan aç. Böylece adres çubuğu kaybolur, yazma alanı büyür ve Safari notları kendiliğinden silmez.

Önemli: Notlar sadece o cihazda durur. Ayarlar → **Yedeği indir** ile yedeği iCloud Drive'a kaydet. Uygulama 7 günde bir hatırlatır.

## Kullanım ipuçları

- Kalem çizer, parmak kaydırır ve iki parmakla yakınlaştırır. Kalemsiz cihazda araç çubuğundaki el ikonu ile "parmakla çiz"i aç.
- İki parmakla ekrana hızlıca dokunmak: geri al.
- Silgiye çizim sırasında tekrar dokunmak: çizgi silgisi / piksel silgisi arasında geçiş.
- Araç çubuğunu tutamacından sürükleyip dört kenardan birine bırakabilirsin; küçült butonu onu tek bir daireye indirir.
- Üst bardaki büyütme ikonu odak modunu açar; geri dönmek için köşedeki yıldıza dokun.
- Listeyi açmak için ekranın sol kenarından sağa kaydır.
- Ders slaytı: Çizim sekmesi → Yeni çizim → **PDF aç**. Slaytlar arasına not sayfası için araç çubuğundaki sayfa ikonu → "Bu sayfadan sonra boş sayfa ekle".
- Resim: çizimde araç çubuğundaki resim ikonu, yazılı notta biçim çubuğundaki resim ikonu (ya da yapıştır).
- Kement: çizgileri veya resimleri daire içine al; sürükle, sağ alt köşeden büyüt, üstteki butonlarla çoğalt ya da sil.
- Yazılı notta tablo: tablo ikonu; tablonun içindeyken altta satır/sütun butonları çıkar.
- Alt/üst simge: biçim çubuğunda x₂ (PaO₂) ve x² (m²). Ω butonu ° ± µ ≤ ≥ → Δ gibi sembolleri açar.
- PDF olarak paylaş: üst bardaki "…" menüsü. iPad'de paylaşım sayfası açılır (WhatsApp, AirDrop, Dosyalar, Yazdır).
- Slaytlarda arama: PDF defterinde üst bardaki büyüteç. Kenar çubuğundaki arama da slayt yazılarını tarar.
- Şekiller: araç çubuğundaki ok ikonu; tekrar dokununca çizgi / ok / dikdörtgen / elips seçilir.
- Ders kaydı: üst bardaki mikrofon. Kayıt sırasında yazdıkların kayda bağlanır; sonra kaydı açıp "Nota dokun" ile bir satıra veya çizgiye dokununca o an çalar.

## Gerçek iPad'de kontrol listesi

Otomatik testler tarayıcı emülasyonunda çalışıyor; şunları gerçek iPad'de bir kez dene:

- [ ] Avuç ekrana değerken kalemle çizim bozulmuyor (palm rejection)
- [ ] Hızlı çizimde çizgi kalemin ucunu geriden takip etmiyor
- [ ] Kalem basıncı çizgi kalınlığını değiştiriyor
- [ ] Uygulamayı kapatıp açınca notlar yerinde
- [ ] Uçak modunda uygulama açılıyor ve not alınabiliyor
- [ ] Yedek indirip "Yedekten geri yükle" ile geri alınabiliyor
- [ ] 50+ sayfalık bir ders PDF'inde hızlı kaydırırken sayfalar geliyor, uygulama kapanmıyor
- [ ] Fotoğraflar'dan resim eklenebiliyor (iPad fotoğrafı HEIC olsa bile)
- [ ] Kement ile seçip kalemle ve parmakla taşınabiliyor
- [ ] Ders kaydı 45+ dakika sorunsuz sürüyor, sonra nota dokununca doğru ana gidiyor
- [ ] Kayıt sırasında uygulamadan çıkıp dönünce kaydedilen kısım duruyor
- [ ] "PDF olarak paylaş" ile WhatsApp'a ve Dosyalar'a gönderilebiliyor, Yazdır görünüyor
- [ ] Slaytlarda arama gerçek ders PDF'lerinde sonuç buluyor

## Proje yapısı

```
src/
  db/          Dexie veritabanı ve kayıt fonksiyonları
  drawing/     çizim motoru (canvas, kalem, silgi, araç çubuğu)
  text/        Tiptap editörü ve biçim çubuğu
  lib/         arama, silgi geometrisi, yedek al/yükle, dosya/resim hazırlama
  pdf/         pdf.js ile PDF okuma, sayfa render ve yazı çıkarma
  export/      notu PDF'e çevirme (pdf-lib) ve paylaşma
  state/       ayarlar (localStorage)
  ui/          kenar çubuğu, üst bar, ayarlar, bildirimler
```

## Sıradaki adımlar (Faz 3)

Elle çizilen daireyi/oku otomatik tanıyıp düzgün şekle çevirme.
