# notlarım — tasarım dokümanı

Tarih: 2026-09-25
Durum: Faz 1, Faz 2 ve perfüzyon eklentileri kodlandı

## Amaç

iPad + Apple Pencil ile kullanılacak, yazılı ve çizimli notları tek yerde tutan, hesap gerektirmeyen, tamamen ücretsiz bir not uygulaması. Birincil kullanıcı bir sağlık öğrencisi: ders slaytları üzerine not alma ve anatomi çizimleri önemli.

## Temel kararlar

- **Platform:** PWA, Vite + React + TypeScript. Sunucu yok, Vercel'e statik site olarak deploy edilir.
- **Depolama:** Sadece cihazda, IndexedDB (Dexie). Hesap ve bulut yok. Veri güvencesi: kalıcı depolama izni, JSON yedek dosyası, 7 günlük yedek hatırlatması, çöp kutusu.
- **Yazılı notlar:** Tiptap (StarterKit + TaskList + Highlight + Placeholder).
- **Çizim:** Kendi motorumuz. perfect-freehand ile basınca duyarlı çizgi, HTML Canvas ile render (taban canvas + canlı çizim canvas'ı).
- **Animasyon:** Motion (`motion/react`), sadece `transform` ve `opacity`. Çizim alanında animasyon yok. `prefers-reduced-motion` desteklenir.

## Bilgi mimarisi

İki sekme: **Yazılı** ve **Çizim**. Klasörler ve etiketler iki sekme arasında ortaktır; sekme listeyi not türüne göre filtreler. Kenar çubuğunda: sekmeler, arama, klasörler (Tüm notlar, kullanıcı klasörleri, Çöp kutusu), etiket filtresi, not listesi.

Çizim notu oluştururken mod seçilir: **Defter** (A4 oranlı sayfalar, çizgili/kareli/noktalı/boş) veya **Sonsuz tuval** (her yöne kaydırılan alan).

## Veri modeli

- `folders`: id, name, createdAt
- `notes`: id, type (`text` | `drawing`), title, folderId, tags[], createdAt, updatedAt, deletedAt, searchText, drawMode, paper
- `texts`: noteId, doc (Tiptap JSON)
- `drawings`: noteId, pages[] → her sayfa strokes[] → her çizgi: id, tool, color, size, sp (basınç simülasyonu), points [x, y, basınç][]
- `meta`: anahtar/değer (son yedek tarihi, erteleme vb.)

Çizgi noktaları sayfa koordinatlarında saklanır (sayfa genişliği 1000 birim). Arama metni not kaydedilirken `searchText` alanına yazılır.

## Ekran ve etkileşim

- Not açıkken ekranın neredeyse tamamı yazı/çizim alanıdır. Not açılınca kenar çubuğu kapanır (≥1280px genişlikte açık kalır). Sol kenardan kaydırma veya menü butonu ile geri açılır.
- İnce üst bar: menü, başlık, kaydedildi yıldızı, odak modu, diğer (klasör, etiket, çöp). Odak modunda üst bar gizlenir, köşede küçük yıldız buton kalır.
- Çizim araç çubuğu yüzen bir hap: dört kenardan birine sürüklenir, tek dokunuşla küçük bir daireye küçülür.
- Defter modu fit-to-width açılır, iki parmakla zoom/pan.
- Apple Pencil çizer, parmak kaydırır (palm rejection). "Parmakla çiz" anahtarı kalemsiz cihazlar için. İki parmakla dokunma = geri al.
- Silgi: çizgi silgisi (tüm çizgiyi siler) ve piksel silgisi (çizgiyi böler).

## Görsel dil

Açık pembe zemin #FBEAF0, pembe vurgular #ED93B1 / #D4537E, ana renk bordo #72243E. Fontlar Fredoka (başlık) ve Nunito (metin), uygulamaya gömülü. Yıldızlar sadece kenarlarda ve boş alanlarda; yazı/çizim alanına girmez. Koyu tema: koyu bordo zemin, pembe vurgular, sistem ayarına göre otomatik. Telefonda tek sütun ve sekmeler altta; iPad yatayda kenar çubuğu + not; masaüstünde iki panel.

## Hata yönetimi

- Depolama dolarsa (QuotaExceededError) çökmez, uyarı gösterir.
- Kalıcı depolama izni yoksa "Ana Ekrana Ekle" banner'ı.
- Son yedekten 7 gün geçtiyse hatırlatma.
- Bozuk yedek dosyası tamamen doğrulanmadan hiçbir şey yazılmaz. Geri yüklemede aynı not varsa daha yeni olan korunur.
- Yeni sürüm kendiliğinden yenilenmez, "Yeni sürüm hazır" bildirimi çıkar.
- Kenar çubuğu, yazılı editör ve çizim editörü ayrı error boundary içinde.
- Silinen notlar çöp kutusuna gider, kalıcı silme ayrıca onay ister.

## Test

- Vitest: piksel silgisinin çizgi bölmesi, Türkçe harf duyarlı arama, yedek al → geri yükle birebir aynı (fake-indexeddb).
- Playwright (WebKit + dokunmatik emülasyon): Faz 1 sonrası eklenecek.
- Gerçek iPad kontrol listesi: palm rejection, çizim gecikmesi, kapat/aç sonrası notlar, offline çalışma.

## Faz 2 kararları

Faz 2'nin kapsamı ilk tasarımda onaylanmıştı; ayrıntıları kodlarken aşağıdaki gibi netleştirildi.

- **PDF:** "Yeni çizim → PDF aç". PDF'in kendisi `files` tablosunda saklanır, her PDF sayfası bir defter sayfası olur (genişlik 1000, yükseklik PDF oranında). Sayfalar pdf.js ile ekrandaki boyuta göre 4 çözünürlük kademesinden birinde render edilir, en fazla 14 sayfa görüntüsü bellekte tutulur. pdf.js ayrı bir Web Worker'da çalışır. Şifreli PDF'ler açılmaz, anlaşılır hata verilir.
- **Slaytlar arasına sayfa:** araç çubuğundaki sayfa menüsü ekrandaki sayfanın hemen arkasına aynı boyutta boş sayfa ekler (PDF defterlerinde çizgili), sayfa silme de aynı menüde. Sağ altta "3 / 12" sayfa göstergesi var. Her notun zoom ve kaydırma konumu hatırlanır.
- **Çizime resim:** resim en uzun kenarı 2000px olacak şekilde küçültülüp `files` tablosuna yazılır; sayfada `images` listesinde konum ve boyutla durur, çizgilerin altında çizilir. Eklenen resim otomatik seçilir.
- **Kement (lasso):** noktalarının yarısından fazlası kementin içinde kalan çizgiler ve merkezi içinde kalan resimler seçilir. Seçim sürüklenerek taşınır, sağ alt tutamaçla orantılı büyütülür/küçültülür, "Çoğalt" ve "Sil" butonları var. Seçim tek sayfa içindedir. Kalem kapalıyken parmakla da seçim taşınabilir.
- **Yazılı notlarda resim:** araç çubuğundan, yapıştırarak veya sürükleyerek. Resim `files` tablosunda, notta sadece referansı durur (yazarken megabaytlar tekrar kaydedilmez). Küçük/Orta/Tam genişlik seçilebilir.
- **Tablo:** 3×3 başlıklı tablo; tablo içindeyken satır/sütun ekle, sil, başlık satırı, tabloyu sil çubuğu açılır.
- **Yedek v2:** PDF ve resimler yedeğe base64 olarak girer. v1 yedekler açılmaya devam eder. Kalıcı silinen notun dosyaları da silinir.
- **Bilinen sınır:** yazılı nottan silinen bir resmin dosyası not kalıcı silinene kadar yer kaplar. Büyük PDF'lerde yedek dosyası da büyür.

## Perfüzyon öğrencisi için eklenenler

Kullanıcının seçtiği 5 özellik. Kararlar kodlarken verildi.

- **PDF olarak paylaş:** üst bardaki "…" menüsünde. iPad'de paylaşım sayfası açılır (AirDrop, WhatsApp, Posta, Dosyalar, Yazdır), bilgisayarda dosya iner. Çizimler vektör olarak çıkar; PDF slaytları orijinal sayfa olarak kopyalanır (seçilebilir yazı korunur), notlar üstüne çizilir, araya eklenen sayfalar da gelir. Yazılı notlar pdf-lib ile sayfalanır: başlık, tarih, başlıklar, listeler, checklist, tablo, resim, alıntı, alt/üst simge, fosforlu, sayfa numarası. Yazı tipleri uygulamanın kendi fontları; Türkçe harfler için latin + latin-ext dosyaları, ₂ ≤ → Δ gibi semboller için DejaVu'dan alt küme alınmış "Notlarim Symbols" fontu kullanılır. Dışa aktarmadan önce editörler bekleyen değişikliği kaydeder.
- **Alt/üst simge ve semboller:** biçim çubuğunda x₂ ve x² (Tiptap Subscript/Superscript) ve Ω butonuyla açılan sembol satırı (° ± µ × ≈ ≤ ≥ → ↑ ↓ Δ α β γ ‰ √ ✓ …).
- **PDF içinde arama:** PDF'in yazıları konumlarıyla birlikte `pdftext` tablosuna çıkarılır (eski PDF'lerde ilk açılışta). Kenar çubuğu araması slayt yazılarını da tarar ve eşleşen yeri gösterir; sonuçtan açılan PDF ilk eşleşen slayta gider. Not içindeki arama panelinde sonuçlar sayfa sayfa listelenir, kelimeler sayfada işaretlenir. Taranmış (resim) PDF'lerde yazı olmadığı açıkça söylenir. El yazısı aranmaz.
- **Şekil araçları:** çizgi, ok, dikdörtgen, elips. Şekiller eşit kalınlıkta normal çizgi olarak kaydedilir; silgi, kement, geri al ve PDF dışa aktarma aynen çalışır. Çizgi ve ok yatay/dikey/45°'ye birkaç derece yakınsa oturur.
- **Ses kaydı:** not başına kayıt, üst bardaki mikrofon. Kayıt 5 saniyelik parçalar halinde anında veritabanına yazılır; sekme kapanırsa açılışta yarım kayıt kurtarılır. Kayıt sırasında çizilen her çizgi ve yazılan her paragraf zaman damgası alır (`Stroke.t`, paragraf `ts`). Oynatıcıda "Nota dokun" açıkken bir çizgiye veya paragrafa dokunmak kaydı o anın 2 saniye öncesine sarar; henüz yazılmamış kısımlar soluk görünür. Hız 1×/1.25×/1.5×/2×. Ekran kilitlenirse iOS kaydı durdurur; wake lock ile ekranın kendiliğinden kararması engellenir.
- **Yedek v3:** ses kayıtları da yedeğe girer. PDF yazıları yedeğe girmez, gerekince yeniden çıkarılır.
- **Bilinen sınırlar:** döndürülmüş (rotate) PDF sayfalarında dışa aktarılan notlar kayabilir. Emoji yazılı not PDF'inde kutu olarak çıkar. Önizleme linkinde (claude.ai içinde) mikrofon izni verilmeyebilir; ses kaydı gerçek sürümde (Vercel) çalışır.

## Fazlar

- **Faz 1 (bu sürüm):** iki sekme, IndexedDB, yazılı notlarda biçim + checklist + fosforlu, çizimde kalem/fosforlu/silgi/renk/kalınlık/undo/redo, defter ve sonsuz tuval, klasör/etiket/arama, çöp kutusu, yedek al/yükle, PWA, Vercel deploy.
- **Faz 2 (bu sürüm):** PDF içe aktarıp üzerine yazma, çizime resim ekleme, lasso ile seç/taşı/boyutlandır, yazılı notlarda resim ve tablo, slaytlar arasına boş sayfa.
- **Faz 3:** elle çizilen şekli tanıyıp düzeltme (şekil araçları eklendi, otomatik tanıma sırada).
