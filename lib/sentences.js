// The built-in passage pools. Characters are limited to [A-Za-z ,.] on
// purpose: phone keyboards swap in curly quotes and apostrophes that can
// never be matched against the passage, so the pools simply avoid them.
// Indonesian passages likewise avoid hyphenated reduplication (kupu-kupu),
// since the charset allows no hyphens; reduplications are written with a
// space instead. Code passages read like code through dotted names
// (item.price, pengguna.nama) — the inner dots sit between letters, so the
// two-sentence split keeps working.
//
// pickPassage(choice, rand) returns the race's text: two distinct sentences
// from one pool, joined by one space. `rand` is injectable so preview
// replays (`?un-now=`) and tests stay deterministic.

const POOLS = {
  en: {
    quotes: [
      'Practice makes perfect, and patience makes it last.',
      'A journey of a thousand miles begins with one small step.',
      'Slow and steady wins the race, every single time.',
      'Many hands make light work of the biggest job.',
      'A rolling stone gathers no moss, or so they say.',
      'Better late than never, but better early than late.',
      'Two heads are better than one when the road splits.',
      'Where there is a will, there is always a way.',
      'Do not count your chickens before they hatch.',
      'Every cloud has a silver lining if you look long enough.',
      'The best time to plant a tree was twenty years ago.',
      'Actions speak louder than words in the end.',
      'Rome was not built in a day, and neither is a garden.',
      'The early bird catches the worm, so the saying goes.',
    ],
    news: [
      'The town library will stay open until nine on Fridays this summer.',
      'A new bike path along the river opens to riders next Monday morning.',
      'The weekend market moves to the square by the fountain this month.',
      'Volunteers planted two hundred trees along the old canal path today.',
      'The annual kite festival returns to the hill with forty flyers.',
      'The ferry adds a late evening crossing for summer weekend visitors.',
      'School children opened a small vegetable stand by the bus stop.',
      'The community garden doubled in size after spring clean up week.',
      'A lost parrot was found singing in the bakery and went home fed.',
      'The old cinema reopens with a weekend of films and free popcorn.',
      'Night buses will run every half hour through the winter months.',
      'The river path gets new benches painted by local artists this spring.',
      'A record sixty rowers joined the dawn race across the calm bay.',
      'The toy library lends games and puzzles to families every Saturday.',
    ],
    everyday: [
      'The little red boat drifted past the lighthouse as the sun went down.',
      'Gulls circled slowly over the quiet harbor before the storm arrived.',
      'A cold wind carried the smell of rain across the open field.',
      'We packed bread, cheese and two apples for the long walk home.',
      'The train left the station on time and rolled into the green valley.',
      'Snow fell softly on the rooftops and no one went outside all morning.',
      'She read the map twice and still turned left at the old bridge.',
      'Fresh bread from the corner bakery sells out before nine each day.',
      'The river bends around the hill and slows near the willow trees.',
      'Our tent held through the night though the wind never really stopped.',
      'The market opens early and the best fruit goes within the first hour.',
      'He fixed the fence with three nails and a piece of wire.',
      'Clouds gathered over the mountains and the air turned cool and still.',
      'We watched the tide come in until the first stars appeared.',
      'The old clock on the wall ticks louder when the house is silent.',
      'A single lamp lit the room and the pages of the open book.',
      'They walked the coastal path and counted boats in the bay below.',
      'The soup needs salt, a little pepper and ten more minutes.',
      'Morning fog lay low over the fields until the sun burned it away.',
      'The dog slept under the table while the rain tapped on the window.',
      'We took the long road home to see the orchards in full bloom.',
      'A kite climbed above the hill and hung there in the steady wind.',
      'The cafe was full, so we drank our coffee standing at the bar.',
      'Autumn came early this year and the leaves turned almost overnight.',
      'She wrote the letter by hand and posted it on the way to work.',
      'The garden path ends at a wooden gate and a view of the lake.',
      'Thunder rolled in the distance but the storm never reached the town.',
      'He carried the boxes up the stairs and stopped to catch his breath.',
      'The ferry to the island leaves twice a day, once at dawn.',
      'Wildflowers covered the meadow in every colour the summer could offer.',
      'We shared the last of the cake and promised to bake another soon.',
      'The museum was quiet on Tuesday and we had the rooms to ourselves.',
      'A fox crossed the road, paused, and vanished into the hedgerow.',
      'The forecast promised sun, so we left our coats at the hotel.',
      'Grandmother kept jars of honey on the shelf above the sink.',
      'The bus was late, the rain was heavy, and the day got better anyway.',
      'Birds gathered on the wire above the yard as evening came on.',
      'We found a table by the window and watched the street fill with light.',
      'The mountain path was steep but the view at the top repaid every step.',
      'Winter apples keep well in the cellar until the first warm week.',
    ],
    code: [
      'For each item in cart, add item.price to the total.',
      'Set the user.name field before you save the form.',
      'If the list is empty, return null and log a warning.',
      'Loop over rows and copy each row.id into the results.',
      'Call api.fetch once, then store the response.data in cache.',
      'Rename the old index.html file before you deploy the build.',
      'The function counts words and returns the longest word found.',
      'Sort the array by date, then group items by user.id.',
      'A loop that runs twice per second keeps the clock in sync.',
      'Store the token in a variable named session.token for later.',
      'When the value is null, the code falls back to config.default.',
      'Add a comment above each function that explains its one job.',
      'Compare the local copy with origin.main before you merge.',
      'The test asserts that the server answers with a json body.',
    ],
  },
  id: {
    quotes: [
      'Sedikit demi sedikit, lama kelamaan menjadi bukit.',
      'Berakit rakit ke hulu, berenang renang ke tepian.',
      'Ringan sama dijinjing, berat sama dipikul bersama.',
      'Dimana bumi dipijak, disitu langit dijunjung tinggi.',
      'Ilmu tanpa amal adalah seperti pohon tanpa buah.',
      'Air beriak tanda dalam, perkataan lembut tanda bijak.',
      'Gajah di pelupuk mata tak tampak, kuman di seberang lautan tampak.',
      'Karena nila setitik, rusak susu sebelanga penuh.',
      'Sedia payung sebelum hujan, sedia jawab sebelum tanya.',
      'Melentur buluh biarlah dari rebungnya, mendidik anak sejak kecil.',
      'Bagai air di daun talas, begitu pula tamu di rumah.',
      'Sepandai pandai tupai melompat, akhirnya jatuh juga.',
      'Besar pasak daripada tiang, lebih banyak utang daripada upah.',
      'Tangan di atas lebih terhormat daripada tangan di bawah.',
    ],
    news: [
      'Perpustakaan kota kini buka sampai pukul sembilan setiap Jumat.',
      'Jalur sepeda baru di tepi kali dibuka untuk umum hari Senin.',
      'Pasar akhir pekan pindah ke alun alun dekat menara air bulan ini.',
      'Warga menanam dua ratus pohon di tepi jalan tua hari ini.',
      'Festival layang layang kembali di bukit dengan empat puluh peserta.',
      'Kapal kecil menambah jadwal malam untuk pengunjung akhir pekan.',
      'Anak sekolah membuka stan sayur kecil di dekat halte bus.',
      'Kebun komunitas meluas dua kali lipat setelah kerja bakti semi.',
      'Bioskop tua dibuka kembali dengan film klasik akhir pekan ini.',
      'Bus malam beroperasi setiap setengah jam sepanjang bulan dingin.',
      'Kursi baru di jalur kali dilukis oleh pelukis lokal musim ini.',
      'Enam puluh pendayung ikut lomba fajar menyeberangi teluk tenang.',
      'Taman kota mendapat taman bermain baru dibuka hari Minggu pagi.',
    ],
    everyday: [
      'Kami berangkat pagi hari dan tiba sebelum matahari terlalu tinggi.',
      'Ibu membuat kopi dan kue untuk tamu yang datang sore ini.',
      'Anak anak bermain di halaman sampai hujan turun sore hari.',
      'Kereta datang tepat waktu dan berhenti lama di stasiun kecil.',
      'Kami berjalan pulang lewat jalan panjang untuk melihat sawah.',
      'Kucing tidur di bawah meja saat hujan menghantam jendela.',
      'Dia membaca surat itu dua kali dan tetap salah ambil jalan.',
      'Roti dari toko sudut habis sebelum pukul sembilan pagi.',
      'Kabut tipis menutupi sawah sampai matahari menghangatkan udara.',
      'Sepeda tua itu masih berjalan baik setelah dua kali diperbaiki.',
      'Kami makan malam bersama dan berjanji berkumpul lagi bulan depan.',
      'Musim hujan datang cepat tahun ini dan daun daun berubah warna.',
      'Angin kencang bertiup dari laut sepanjang sore dan malam hari.',
      'Dia membawa kotak besar menaiki tangga dan berhenti menarik napas.',
    ],
    code: [
      'Untuk setiap barang di keranjang, tambahkan barang.harga ke total.',
      'Isi kolom pengguna.nama sebelum kamu menyimpan formulir ini.',
      'Jika daftar masih kosong, kembalikan null dan catat peringatan.',
      'Ulangi setiap baris dan salin baris.id ke dalam hasil akhir.',
      'Panggil api.ambil sekali, lalu simpan jawaban.data ke memori.',
      'Ubah nama berkas lama sebelum kamu mengirim hasil akhir ini.',
      'Fungsi ini menghitung kata dan mengembalikan kata terpanjang.',
      'Urutkan daftar per tanggal, lalu kelompokkan per pengguna.id.',
      'Simpan token itu dalam variabel bernama sesi.token untuk nanti.',
      'Jika nilai masih null, kode memakai nilai dari bawaan.nilai.',
      'Beri komentar di atas setiap fungsi yang menjelaskan tugasnya.',
      'Bandingkan salinan lokal dengan utama.asal sebelum kamu gabung.',
    ],
  },
};

const LANGUAGES = ['en', 'id'];
const CATEGORIES = ['quotes', 'news', 'everyday', 'code'];

// Backwards-compatible alias: the original pool is the English everyday set.
const SENTENCES = POOLS.en.everyday;

// Resolves the viewer's text choice. A missing, 'any' or unknown language or
// category is replaced by a random valid one, so a race always lands on one
// concrete pool.
function pickPassage(choice, rand = Math.random) {
  const c = choice || {};
  const language = LANGUAGES.includes(c.language)
    ? c.language
    : LANGUAGES[Math.floor(rand() * LANGUAGES.length)];
  const category = CATEGORIES.includes(c.category)
    ? c.category
    : CATEGORIES[Math.floor(rand() * CATEGORIES.length)];
  const pool = POOLS[language][category];
  const a = pool[Math.floor(rand() * pool.length)];
  let b = a;
  while (b === a) b = pool[Math.floor(rand() * pool.length)];
  return { language, category, passage: a + ' ' + b };
}

module.exports = { SENTENCES, POOLS, LANGUAGES, CATEGORIES, pickPassage };

// `rand` defaults to Math.random; the server passes its own generator so
// preview replays (`?un-now=`) and tests stay deterministic.
function pickText(rand = Math.random) {
  return pickPassage({}, rand).passage;
}

module.exports.pickText = pickText;