# Çevrimdışı Ses Transkripti Tasarımı

**Tarih:** 2026-09-25  
**Durum:** Kullanıcı tarafından sohbet içinde onaylandı; uygulama planı öncesi yazılı inceleme bekliyor.

## Amaç

Kullanıcı, tamamlanmış bir ders kaydını isteğe bağlı olarak cihaz üzerinde yazıya çevirebilmeli. Ses ve üretilen metin hiçbir sunucuya gönderilmemeli. Transkript ses kaydının parçası olarak saklanmalı; yazılı notlarda kullanıcı isterse metni notun sonuna ekleyebilmeli. İşlem sürerken metin editörü ve çizim tuvali akıcı kalmalı.

## Kapsam

- Tamamlanmış ses kaydından çevrimdışı, çok dilli transkript üretme.
- İlk kullanımda modeli indirme ve sonraki kullanımlar için tarayıcı önbelleğinde tutma.
- Transkript durumunu, ilerlemesini, sonucunu ve hatasını kayıt bazında gösterme.
- Transkripti ses kaydıyla birlikte IndexedDB'de kalıcı saklama.
- Transkripti kopyalama, yeniden üretme ve yazılı notun sonuna ekleme.
- Transkript verisini yedek alma ve geri yükleme akışına dahil etme.
- Uzun kayıtları parçalı işleyerek ana UI iş parçacığını boş tutma.

Genel metin editörü veya çizim motoru yeniden tasarımı bu işin kapsamında değildir. Bu özellik, mevcut not alma ve çizim deneyiminin performansını bozmama şartına tabidir.

## Kullanıcı Deneyimi

Tamamlanmış her ses kaydının menüsünde **Transkript oluştur** eylemi bulunur. Eylem ilk kez kullanıldığında uygulama yaklaşık model boyutunu açıklar ve indirme/kurulum ilerlemesini gösterir. Model hazır olduğunda durum **Ses hazırlanıyor**, ardından **Yazıya çevriliyor · %N** olur.

İşlem tamamlanınca transkript kayıt satırının altında açılıp kapanabilen bir bölümde gösterilir. Bu bölümde:

- **Kopyala** her not türünde bulunur.
- **Nota ekle** yalnızca yazılı notlarda bulunur ve metni notun sonuna, kayıt tarihini içeren bir başlık altında ekler.
- **Yeniden oluştur** mevcut transkripti değiştirmeden önce kullanıcıdan onay alır.
- Devam eden işlem **İptal** ile durdurulabilir.

Çizim notlarında transkript ayrı bir yazılı not oluşturmaz; ses kaydının içinde kalır.

## Teknik Yaklaşım

### Transkripsiyon motoru

`@huggingface/transformers` ile çok dilli Whisper Tiny'nin tarayıcı uyumlu, nicemlenmiş sürümü kullanılacak. Model Web Worker içinde çalışacak. Uzun kayıtlarda mobil Safari kararlılığı öncelikli olduğundan iOS/iPadOS'ta WASM/CPU kullanılacak. Diğer tarayıcılarda WebGPU kullanılabiliyorsa tercih edilecek, başarısız olursa aynı iş bir kez WASM ile yeniden başlatılacak.

Model yalnızca kullanıcı transkript istediğinde yüklenir. Transformers.js'in tarayıcı önbelleği kullanılır ve modelin gerçekten çevrimdışı yeniden açılabildiği entegrasyon testiyle doğrulanır. Model indirilmeden önce çevrimdışı olunması durumunda kullanıcıya önce internete bağlanıp modeli bir kez indirmesi gerektiği söylenir.

### Ses hazırlama

Kaydın `StoredFile` verisi Blob'a çevrilir ve tarayıcının asenkron `AudioContext.decodeAudioData` motoruyla çözülür. Çözülen örnekler kopyalanmadan Worker'a aktarılır; mono 16 kHz dönüştürme, parçalama ve model çıkarımı Worker içinde yapılır. Uzun ses tek seferde modele verilmez; yaklaşık 30 saniyelik, küçük örtüşmeli parçalara ayrılır. Parçalar sırayla işlenir ve örtüşen tekrarlar temizlenerek birleştirilir.

Ses çözme tarayıcının asenkron ses motoruna bırakılır; dönüştürme ve model çıkarımı ana React iş parçacığında çalışmaz. Aynı anda yalnızca bir transkripsiyon işi yürür; ikinci istek kuyruğa alınmaz, kullanıcıya mevcut iş gösterilir.

### Modül sınırları

- `src/transcription/transcription.worker.ts`: model yükleme, ilerleme olayları, çıkarım ve iptal kontrolü.
- `src/transcription/client.ts`: Worker yaşam döngüsü, kayıt dosyasını hazırlama, durum olayları ve tek-iş kuralı.
- `src/transcription/audio.ts`: ses çözme, 16 kHz mono dönüştürme, parçalama ve metin birleştirme gibi test edilebilir saf yardımcılar.
- `src/ui/RecordingTranscript.tsx`: kayıt bazlı durum, ilerleme, sonuç ve eylemler.
- `src/ui/RecordControl.tsx`: mevcut kayıt listesine transkript bileşenini bağlama.

## Veri Modeli

`Recording` kaydına aşağıdaki isteğe bağlı alanlar eklenir:

```ts
transcript?: {
  status: 'processing' | 'done' | 'error'
  text?: string
  language?: string
  progress?: number
  error?: 'model' | 'decode' | 'memory' | 'cancelled' | 'unknown'
  updatedAt: number
}
```

Dexie şeması yeni bir sürüme yükseltilir. `recordings` indeksleri değişmediği için mevcut kayıtların göç sırasında dönüştürülmesi gerekmez. Uygulama başlangıcında `processing` kalan kayıtlar güvenli biçimde yeniden denenebilir duruma çevrilir; otomatik olarak model çalıştırılmaz.

Transkript kayıtla birlikte silinir. Mevcut yedek formatı yeni bir sürüme çıkarılır ve eski yedekler geriye uyumlu kalır.

## Nota Ekleme

Metin notu açıkken **Nota ekle**, Tiptap editörüne olay/komut yoluyla şu yapıda içerik ekler:

```text
Ses kaydı transkripti — 25 Eyl 2026 14:30

<transkript metni>
```

Ekleme editör geçmişine tek bir işlem olarak girer, geri alınabilir ve mevcut otomatik kayıt akışını kullanır. Aynı transkriptin yanlışlıkla tekrar eklenmesini önlemek için buton işlem sırasında devre dışı kalır; bilinçli ikinci ekleme engellenmez.

## Durum ve Hata Yönetimi

Worker şu olayları üretir: `model-progress`, `ready`, `transcribe-progress`, `complete`, `cancelled`, `error`.

- Model indirme kesilirse kayıt değişmez ve **Tekrar dene** gösterilir.
- Ses çözülemezse kaydın oynatılması etkilenmez.
- Bellek baskısı veya Worker çökmesi yakalanır; iş durumu `error` olur ve UI kullanılabilir kalır.
- Uygulama kapanırsa ses kaydı zarar görmez. Yarım transkript sonucu saklanmaz; kullanıcı yeniden başlatır.
- İptal, Worker'ı sonlandırır ve kalıcı transkript oluşturmaz.
- Model yüklenemeyen cihazlarda hata teknik ayrıntı yerine uygulanabilir bir açıklama gösterir.

## Performans

- Model ve çıkarım kodu başlangıç paketine dahil edilmez; dinamik yüklenir.
- Worker ana iş parçacığını engellemez.
- Ses parçaları sırayla işlenir ve işlem biten ara tamponlar serbest bırakılır.
- İlerleme güncellemeleri UI'ya sınırlı sıklıkta gönderilir.
- Tek aktif iş kuralı, iPad'de eşzamanlı model belleği tüketimini önler.
- iOS/iPadOS'ta WASM kullanılır. Diğer cihazlarda WebGPU işi çökerse Worker kapatılır ve iş bir kez WASM ile baştan denenir; ikinci hata kullanıcıya gösterilir.

## Test Stratejisi

### Birim testleri

- 16 kHz mono dönüştürme ve parça sınırları.
- Örtüşen transkript parçalarını deterministik birleştirme.
- Worker olaylarının uygulama durumuna çevrilmesi.
- Tek aktif iş ve iptal davranışı.
- Transkript veri modelinin kaydedilmesi ve geri yüklenmesi.
- Eski yedeklerin yeni şemaya aktarılması.
- Tiptap'e transkript ekleme içeriği.

### Entegrasyon kontrolleri

- Model ilk kullanımda iner ve ikinci kullanımda önbellekten açılır.
- Ağ kapalıyken önceden indirilmiş modelle transkript üretilir.
- Uzun kayıt işlenirken yazı yazma ve çizim etkileşimleri yanıt vermeye devam eder.
- İşlem sırasında sayfa kapatılıp açıldığında kayıt sağlam kalır ve yeniden deneme sunulur.

### Yayın kapısı

`npm test`, `npm run lint` ve `npm run build` çalıştırılır. Lint'in mevcut `node_modules` tarama yapılandırması ürün kodundan ayrı olarak raporlanır; kaynak dosyalardaki yeni hata ve uyarılar düzeltilir. Gerçek iPad'de kısa Türkçe kayıt, uzun ders kaydı, çevrimdışı tekrar kullanım ve düşük bellek davranışı elle doğrulanır.

## Yayınlama

Uygulama tamamlandıktan ve doğrulamalar geçtikten sonra değişiklikler anlamlı commitlere ayrılır ve `main` dalına pushlanır. Bağlı Vercel projesi otomatik production deployment oluşturur. Canlı URL'nin `200 OK` döndürdüğü ve transkript arayüzünün yüklendiği ayrıca doğrulanır.
