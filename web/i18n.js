// The interface in English, Japanese, Korean and Chinese. English is the key; the other languages are
// looked up by it, so a string without a translation shows in English. The language follows the
// Windows display language unless a choice is saved in the preferences.
export const LANGUAGES = ['en', 'ja', 'ko', 'zh'];

const DICT = {
  ja: {
    'Theme: light, dark, 1 or 2': 'テーマ：ライト・ダーク・1・2',
    'Queue': 'キュー', 'Clear finished': '完了分を消す', 'Songs': '曲',
    'Choose audio files': '音声ファイルを選ぶ', 'Drop audio files here': 'ここに音声ファイルをドロップ', 'Let go to add them': '離すと追加されます',
    'or': 'または', 'choose files': 'ファイルを選ぶ', '· paste a YouTube link in the panel': '・パネルにYouTubeリンクを貼る',
    'MP3 · WAV · FLAC · M4A · YouTube. Add as many songs as you like; they are separated one after another.': 'MP3・WAV・FLAC・M4A・YouTube。曲はいくつでも追加でき、順番に分離されます。',
    'Separating': '分離中', 'Working': '処理中', 'Separation progress': '分離の進行状況', 'Steps': 'ステップ',
    'A 4-minute song takes about a minute. The very first run also downloads the model (about 670 MB).': '4分の曲なら1分ほどです。初回はモデル（約670 MB）のダウンロードも行います。',
    'No supported GPU was found, so this runs on the CPU and takes a while. You can keep using the PC in the meantime.': '対応GPUが見つからないためCPUで処理します。時間はかかりますが、その間もPCは普通に使えます。',
    'Separated': '分離済み', 'Rename the song': '曲名を変更', 'Song name': '曲名', 'Save': '保存', 'Cancel': 'キャンセル',
    'Open folder': 'フォルダを開く', 'Play': '再生', 'Song position': '再生位置', 'Stems': 'ステム',
    'S plays one stem alone, M mutes it. Click a waveform to jump to that point.': 'Sでそのステムだけを再生、Mでミュート。波形をクリックするとその位置に移動します。',
    'Drop audio files to add them': '音声ファイルをドロップして追加',
    'Source': 'ソース', 'YouTube link or audio file path': 'YouTubeリンクまたは音声ファイルのパス', 'Paste a YouTube link…': 'YouTubeリンクを貼り付け…',
    'Add': '追加', 'Choose files…': 'ファイルを選ぶ…', 'All': 'すべて', 'None': 'なし', 'Stems to write': '書き出すステム',
    'Others collects everything that is not in a selected stem.': '「その他」には、選んだステムに入らなかった音がすべて入ります。',
    'Output': '出力', 'Output folder': '出力フォルダ', 'Change': '変更', 'Format': '形式', 'Auto': '自動', 'by the source': '元に合わせる', '24-bit': '24ビット',
    'Files are written as song_instrument.mp3 or .wav. Auto writes WAV for a WAV, FLAC or AIFF file and MP3 for everything else, including YouTube.': 'ファイルは「曲名_楽器.mp3」または「.wav」で書き出されます。自動では、WAV・FLAC・AIFFの元ファイルはWAV、YouTubeを含むそれ以外はMP3になります。',
    'Model': 'モデル', 'best quality': '最高品質', 'faster': '高速', 'Chunk blending': 'チャンクの重ね合わせ', 'Standard': '標準', 'Smoother': 'なめらか', 'about 2× slower': '約2倍遅い',
    'Files': 'ファイル', 'Auto title': '自動タイトル', 'A YouTube song takes the video title unless you renamed it': 'YouTubeの曲は、名前を変えない限り動画タイトルになります',
    'Keep original MP3': '元のMP3を残す', 'Keep the downloaded song next to the stems. Your own files are never deleted': 'ダウンロードした曲をステムと同じ場所に残します。自分のファイルが消されることはありません',
    'Language': '言語', 'Follows the Windows display language when set to Auto.': '「自動」ではWindowsの表示言語に合わせます。',
    'Separate stems': 'ステムを分離', 'Connecting…': '接続中…', 'Progress': '進行状況', 'Notifications': '通知', 'Dismiss': '閉じる', 'Install': 'インストール',
    'No supported GPU: on the CPU this model takes about 25 minutes for a 4-minute song. HT-Demucs 6s is much faster.': '対応GPUなし：CPUではこのモデルは4分の曲に約25分かかります。HT-Demucs 6sならずっと速いです。',
    'No supported GPU: on the CPU this model takes about 2 minutes for a 4-minute song.': '対応GPUなし：CPUではこのモデルは4分の曲に約2分かかります。',
    'Vocals': 'ボーカル', 'Bass': 'ベース', 'Drums': 'ドラム', 'Guitars': 'ギター', 'Piano': 'ピアノ', 'Others': 'その他',
    'silent': '無音', 'SILENT': '無音', 'Loudness compared with the whole song': '曲全体と比べた音量',
    'Solo {stem}': '{stem}をソロ', 'Mute {stem}': '{stem}をミュート', '{stem} volume': '{stem}の音量',
    '{time} · {n} stems · {model} · separated in {s} s · {folder}': '{time}・ステム{n}・{model}・{s}秒で分離・{folder}',
    'Could not play the stems: {error}': 'ステムを再生できません：{error}',
    'Ready': '準備完了', 'In the queue': '待機中', 'Failed': '失敗', 'Cancelled': 'キャンセル済み', '{n} stems · {s} s': 'ステム{n}・{s}秒',
    'Renamed to {name}. The files have the new name.': '「{name}」に変更しました。ファイル名も変わっています。',
    'Preparing': '準備', 'Downloading from YouTube': 'YouTubeからダウンロード', 'Reading audio': '音声を読み込み', 'Loading model': 'モデルを読み込み',
    'Cancelling': 'キャンセル中', 'Writing': '書き出し', 'Downloading': 'ダウンロード中', '{step} done': '{step} 完了', 'Writing {stem}': '{stem}を書き出し',
    'Rename the song and its files (or double-click the song)': '曲名とファイル名を変更（曲をダブルクリックでも可）', 'Rename (or double-click the song)': '名前を変更（曲をダブルクリックでも可）',
    'Rename {title}': '{title}の名前を変更', 'Remove {title}': '{title}を削除', 'Separate {n} songs': '{n}曲を分離',
    'The processing engine stopped. Restart the app.': '処理エンジンが停止しました。アプリを再起動してください。',
    '1 song ready. Press Separate stems.': '1曲の準備ができました。「ステムを分離」を押してください。', '{n} songs ready. Press Separate {n} songs.': '{n}曲の準備ができました。「{n}曲を分離」を押してください。',
    'Ready to separate': '分離の準備完了', 'Pick the stems you want, then press Separate.': '欲しいステムを選んで「分離」を押してください。',
    'It starts when the songs before it are finished.': '前の曲が終わると始まります。', 'This song could not be separated': 'この曲は分離できませんでした',
    'Get it': '入手', 'UT Stems {version} is available (you have {current}).': 'UT Stems {version} が利用できます（現在は {current}）。', 'Installing…': 'インストール中…',
    'Paste a YouTube link or a file path…': 'YouTubeリンクかファイルパスを貼り付け…', 'Could not connect to the processing engine: {error}': '処理エンジンに接続できません：{error}',
    'Paste a YouTube link or choose audio files.': 'YouTubeリンクを貼るか、音声ファイルを選んでください。',
    'Downloading audio from YouTube…': 'YouTubeから音声をダウンロード中…', 'Reading audio…': '音声を読み込み中…', 'Loading the separation model…': '分離モデルを読み込み中…',
    'Separating stems…': 'ステムを分離中…', 'Writing {stem}…': '{stem}を書き出し中…', 'Done in {s} s · {n} stems': '{s}秒で完了・ステム{n}', 'Starting': '開始',
    ' · {n} more in the queue': '・あと{n}曲待機中',
    'Select at least one stem.': 'ステムを1つ以上選んでください。', 'Add a song first.': '先に曲を追加してください。',
    'Paste a YouTube link or choose an audio file.': 'YouTubeリンクを貼るか、音声ファイルを選んでください。', 'File not found: {path}': 'ファイルが見つかりません：{path}',
    'Type a name for the song.': '曲名を入力してください。', 'Wait until the song is separated, then rename it.': '分離が終わってから名前を変更してください。',
    'A song that could not be separated cannot be renamed.': '分離できなかった曲の名前は変更できません。', 'Cancel the song before removing it.': '削除する前にキャンセルしてください。',
    'There is no output folder to open yet.': '開ける出力フォルダがまだありません。',
    'The processing engine is missing. Start UT Stems again to set it up.': '処理エンジンがありません。UT Stemsを再起動してセットアップしてください。',
    'The processing engine did not start in time.': '処理エンジンが時間内に起動しませんでした。',
    'This copy runs without the installer; download the new version from the release page.': 'このコピーはインストーラーなしで動いています。リリースページから新しい版をダウンロードしてください。',
    'The update could not be installed: {error}': 'アップデートをインストールできません：{error}', 'Cancelled.': 'キャンセルしました。',
    'First start': '初回起動', 'Get the processing engine': '処理エンジンを入手',
    'UT Stems separates songs with PyTorch models that run on this PC. They are not in the installer; they are downloaded once, for the graphics card in this PC.': 'UT StemsはこのPCで動くPyTorchモデルで曲を分離します。モデルはインストーラーには含まれず、このPCのグラフィックカードに合わせて一度だけダウンロードします。',
    'Graphics in this PC': 'このPCのグラフィック', 'Installs to': 'インストール先', 'Edition': 'エディション', 'CPU only': 'CPUのみ',
    'about 1.7 GB': '約1.7 GB', 'about 1.2 GB': '約1.2 GB', 'about 200 MB': '約200 MB',
    'Download the processing engine': '処理エンジンをダウンロード', 'Download and install': 'ダウンロードしてインストール', 'Starting…': '開始中…',
    'Already have the file?': 'ファイルをお持ちですか？', 'Use a downloaded archive…': 'ダウンロード済みのアーカイブを使う…', 'Nothing is installed yet.': 'まだ何もインストールされていません。',
    'For NVIDIA GPUs (GTX 10 series or newer, current driver). Also runs on the CPU when no GPU is found, so it is a safe choice for any PC.': 'NVIDIA GPU（GTX 10シリーズ以降、最新ドライバー）向け。GPUがなければCPUで動くので、どのPCでも安全な選択です。',
    'For Intel Arc A/B series and the Arc graphics in Core Ultra laptops, with a recent Intel graphics driver.': 'Intel Arc A/BシリーズとCore UltraノートのArcグラフィック向け（最新のIntelグラフィックドライバーが必要）。',
    'For PCs without a supported GPU (or with an AMD GPU). Separation is slower: about 25 minutes for a 4-minute song with the best model.': '対応GPUがない（またはAMD GPUの）PC向け。分離は遅く、最高品質モデルで4分の曲に約25分かかります。',
    'Needs about {need} free while installing.': 'インストール中は約{need}の空きが必要です。', '{free} is free.': '空きは{free}です。',
    'Not enough space on this drive. Make room, then start UT Stems again.': 'このドライブの空き容量が足りません。空けてからUT Stemsを再起動してください。',
    'Using {file}.': '{file}を使います。', 'Install from the file': 'ファイルからインストール', 'Download and update': 'ダウンロードして更新',
    'Download started': 'ダウンロードを開始しました', 'The engine is installed': 'エンジンをインストールしました', 'Starting UT Stems…': 'UT Stemsを起動中…',
    'No graphics adapter reported': 'グラフィックアダプターが報告されていません', 'Update the processing engine': '処理エンジンを更新',
    'This version of UT Stems needs engine {app}; the installed engine is {installed}.': 'このUT Stemsにはエンジン{app}が必要ですが、インストール済みは{installed}です。',
    'older': '旧版', 'Engine {version} · {edition} installed': 'エンジン{version}・{edition} インストール済み',
    'Downloading · {done} of {total}': 'ダウンロード中・{done} / {total}', ' · {min} min left': '・残り{min}分', 'Downloading the engine…': 'エンジンをダウンロード中…',
    'Checking the file…': 'ファイルを確認中…', 'Unpacking · {done} of {total}': '展開中・{done} / {total}', 'Unpacking the engine…': 'エンジンを展開中…', 'Could not start: {error}': '起動できません：{error}',
  },
  ko: {
    'Theme: light, dark, 1 or 2': '테마: 밝게, 어둡게, 1, 2',
    'Queue': '대기열', 'Clear finished': '완료 항목 지우기', 'Songs': '곡',
    'Choose audio files': '오디오 파일 선택', 'Drop audio files here': '여기에 오디오 파일을 놓으세요', 'Let go to add them': '놓으면 추가됩니다',
    'or': '또는', 'choose files': '파일 선택', '· paste a YouTube link in the panel': '· 패널에 유튜브 링크 붙여넣기',
    'MP3 · WAV · FLAC · M4A · YouTube. Add as many songs as you like; they are separated one after another.': 'MP3 · WAV · FLAC · M4A · 유튜브. 곡은 원하는 만큼 추가할 수 있고, 차례로 분리됩니다.',
    'Separating': '분리 중', 'Working': '작업 중', 'Separation progress': '분리 진행률', 'Steps': '단계',
    'A 4-minute song takes about a minute. The very first run also downloads the model (about 670 MB).': '4분짜리 곡은 1분 정도 걸립니다. 맨 처음 실행에서는 모델(약 670 MB)도 내려받습니다.',
    'No supported GPU was found, so this runs on the CPU and takes a while. You can keep using the PC in the meantime.': '지원되는 GPU가 없어 CPU로 처리합니다. 시간이 꽤 걸리지만 그동안 PC는 계속 쓸 수 있어요.',
    'Separated': '분리 완료', 'Rename the song': '곡 이름 바꾸기', 'Song name': '곡 이름', 'Save': '저장', 'Cancel': '취소',
    'Open folder': '폴더 열기', 'Play': '재생', 'Song position': '재생 위치', 'Stems': '스템',
    'S plays one stem alone, M mutes it. Click a waveform to jump to that point.': 'S는 그 스템만 재생, M은 음소거입니다. 파형을 클릭하면 그 지점으로 이동합니다.',
    'Drop audio files to add them': '오디오 파일을 놓으면 추가됩니다',
    'Source': '소스', 'YouTube link or audio file path': '유튜브 링크 또는 오디오 파일 경로', 'Paste a YouTube link…': '유튜브 링크 붙여넣기…',
    'Add': '추가', 'Choose files…': '파일 선택…', 'All': '모두', 'None': '없음', 'Stems to write': '저장할 스템',
    'Others collects everything that is not in a selected stem.': '그 외에는 선택한 스템에 들어가지 않은 소리가 모두 모입니다.',
    'Output': '출력', 'Output folder': '출력 폴더', 'Change': '변경', 'Format': '형식', 'Auto': '자동', 'by the source': '원본에 따라', '24-bit': '24비트',
    'Files are written as song_instrument.mp3 or .wav. Auto writes WAV for a WAV, FLAC or AIFF file and MP3 for everything else, including YouTube.': '파일은 곡이름_악기.mp3 또는 .wav로 저장됩니다. 자동은 원본이 WAV, FLAC, AIFF면 WAV로, 유튜브를 포함한 나머지는 MP3로 저장합니다.',
    'Model': '모델', 'best quality': '최고 품질', 'faster': '빠름', 'Chunk blending': '청크 블렌딩', 'Standard': '표준', 'Smoother': '더 매끄럽게', 'about 2× slower': '약 2배 느림',
    'Files': '파일', 'Auto title': '자동 제목', 'A YouTube song takes the video title unless you renamed it': '유튜브 곡은 이름을 바꾸지 않는 한 영상 제목을 씁니다',
    'Keep original MP3': '원본 MP3 유지', 'Keep the downloaded song next to the stems. Your own files are never deleted': '내려받은 곡을 스템 옆에 남겨 둡니다. 직접 넣은 파일은 절대 지우지 않습니다',
    'Language': '언어', 'Follows the Windows display language when set to Auto.': '자동이면 Windows 표시 언어를 따릅니다.',
    'Separate stems': '스템 분리', 'Connecting…': '연결 중…', 'Progress': '진행률', 'Notifications': '알림', 'Dismiss': '닫기', 'Install': '설치',
    'No supported GPU: on the CPU this model takes about 25 minutes for a 4-minute song. HT-Demucs 6s is much faster.': '지원 GPU 없음: CPU에서는 이 모델이 4분짜리 곡에 약 25분 걸립니다. HT-Demucs 6s가 훨씬 빠릅니다.',
    'No supported GPU: on the CPU this model takes about 2 minutes for a 4-minute song.': '지원 GPU 없음: CPU에서는 이 모델이 4분짜리 곡에 약 2분 걸립니다.',
    'Vocals': '보컬', 'Bass': '베이스', 'Drums': '드럼', 'Guitars': '기타', 'Piano': '피아노', 'Others': '그 외',
    'silent': '무음', 'SILENT': '무음', 'Loudness compared with the whole song': '곡 전체 대비 음량',
    'Solo {stem}': '{stem} 솔로', 'Mute {stem}': '{stem} 음소거', '{stem} volume': '{stem} 음량',
    '{time} · {n} stems · {model} · separated in {s} s · {folder}': '{time} · 스템 {n}개 · {model} · {s}초 만에 분리 · {folder}',
    'Could not play the stems: {error}': '스템을 재생할 수 없습니다: {error}',
    'Ready': '준비됨', 'In the queue': '대기 중', 'Failed': '실패', 'Cancelled': '취소됨', '{n} stems · {s} s': '스템 {n}개 · {s}초',
    'Renamed to {name}. The files have the new name.': '"{name}"(으)로 바꿨습니다. 파일 이름도 바뀌었습니다.',
    'Preparing': '준비', 'Downloading from YouTube': '유튜브에서 내려받기', 'Reading audio': '오디오 읽기', 'Loading model': '모델 불러오기',
    'Cancelling': '취소 중', 'Writing': '저장', 'Downloading': '내려받는 중', '{step} done': '{step} 완료', 'Writing {stem}': '{stem} 저장',
    'Rename the song and its files (or double-click the song)': '곡과 파일 이름 바꾸기 (곡을 더블클릭해도 됩니다)', 'Rename (or double-click the song)': '이름 바꾸기 (곡을 더블클릭해도 됩니다)',
    'Rename {title}': '{title} 이름 바꾸기', 'Remove {title}': '{title} 삭제', 'Separate {n} songs': '{n}곡 분리',
    'The processing engine stopped. Restart the app.': '처리 엔진이 멈췄습니다. 앱을 다시 시작하세요.',
    '1 song ready. Press Separate stems.': '1곡이 준비됐습니다. 스템 분리를 누르세요.', '{n} songs ready. Press Separate {n} songs.': '{n}곡이 준비됐습니다. {n}곡 분리를 누르세요.',
    'Ready to separate': '분리 준비 완료', 'Pick the stems you want, then press Separate.': '원하는 스템을 고른 뒤 분리를 누르세요.',
    'It starts when the songs before it are finished.': '앞의 곡들이 끝나면 시작됩니다.', 'This song could not be separated': '이 곡은 분리하지 못했습니다',
    'Get it': '받기', 'UT Stems {version} is available (you have {current}).': 'UT Stems {version}이 나왔습니다 (현재 {current}).', 'Installing…': '설치 중…',
    'Paste a YouTube link or a file path…': '유튜브 링크나 파일 경로 붙여넣기…', 'Could not connect to the processing engine: {error}': '처리 엔진에 연결할 수 없습니다: {error}',
    'Paste a YouTube link or choose audio files.': '유튜브 링크를 붙여넣거나 오디오 파일을 선택하세요.',
    'Downloading audio from YouTube…': '유튜브에서 오디오를 내려받는 중…', 'Reading audio…': '오디오 읽는 중…', 'Loading the separation model…': '분리 모델 불러오는 중…',
    'Separating stems…': '스템 분리 중…', 'Writing {stem}…': '{stem} 저장 중…', 'Done in {s} s · {n} stems': '{s}초 만에 완료 · 스템 {n}개', 'Starting': '시작',
    ' · {n} more in the queue': ' · {n}곡 더 대기 중',
    'Select at least one stem.': '스템을 하나 이상 선택하세요.', 'Add a song first.': '먼저 곡을 추가하세요.',
    'Paste a YouTube link or choose an audio file.': '유튜브 링크를 붙여넣거나 오디오 파일을 선택하세요.', 'File not found: {path}': '파일을 찾을 수 없습니다: {path}',
    'Type a name for the song.': '곡 이름을 입력하세요.', 'Wait until the song is separated, then rename it.': '분리가 끝난 뒤에 이름을 바꾸세요.',
    'A song that could not be separated cannot be renamed.': '분리하지 못한 곡은 이름을 바꿀 수 없습니다.', 'Cancel the song before removing it.': '삭제하기 전에 먼저 취소하세요.',
    'There is no output folder to open yet.': '아직 열 수 있는 출력 폴더가 없습니다.',
    'The processing engine is missing. Start UT Stems again to set it up.': '처리 엔진이 없습니다. UT Stems를 다시 시작해 설치하세요.',
    'The processing engine did not start in time.': '처리 엔진이 제때 시작되지 않았습니다.',
    'This copy runs without the installer; download the new version from the release page.': '이 복사본은 설치 없이 실행 중입니다. 릴리즈 페이지에서 새 버전을 받으세요.',
    'The update could not be installed: {error}': '업데이트를 설치할 수 없습니다: {error}', 'Cancelled.': '취소했습니다.',
    'First start': '첫 실행', 'Get the processing engine': '처리 엔진 받기',
    'UT Stems separates songs with PyTorch models that run on this PC. They are not in the installer; they are downloaded once, for the graphics card in this PC.': 'UT Stems는 이 PC에서 돌아가는 PyTorch 모델로 곡을 분리합니다. 모델은 설치 파일에 들어 있지 않고, 이 PC의 그래픽카드에 맞춰 한 번만 내려받습니다.',
    'Graphics in this PC': '이 PC의 그래픽', 'Installs to': '설치 위치', 'Edition': '에디션', 'CPU only': 'CPU 전용',
    'about 1.7 GB': '약 1.7 GB', 'about 1.2 GB': '약 1.2 GB', 'about 200 MB': '약 200 MB',
    'Download the processing engine': '처리 엔진 내려받기', 'Download and install': '내려받아 설치', 'Starting…': '시작하는 중…',
    'Already have the file?': '이미 파일이 있나요?', 'Use a downloaded archive…': '내려받은 압축 파일 사용…', 'Nothing is installed yet.': '아직 아무것도 설치되지 않았습니다.',
    'For NVIDIA GPUs (GTX 10 series or newer, current driver). Also runs on the CPU when no GPU is found, so it is a safe choice for any PC.': 'NVIDIA GPU(GTX 10 시리즈 이상, 최신 드라이버)용. GPU가 없으면 CPU로 돌아가므로 어떤 PC에서든 안전한 선택입니다.',
    'For Intel Arc A/B series and the Arc graphics in Core Ultra laptops, with a recent Intel graphics driver.': 'Intel Arc A/B 시리즈와 Core Ultra 노트북의 Arc 그래픽용. 최신 Intel 그래픽 드라이버가 필요합니다.',
    'For PCs without a supported GPU (or with an AMD GPU). Separation is slower: about 25 minutes for a 4-minute song with the best model.': '지원 GPU가 없거나 AMD GPU인 PC용. 분리가 느려서 최고 품질 모델로 4분짜리 곡에 약 25분 걸립니다.',
    'Needs about {need} free while installing.': '설치 중에 약 {need}의 여유 공간이 필요합니다.', '{free} is free.': '{free} 남아 있습니다.',
    'Not enough space on this drive. Make room, then start UT Stems again.': '이 드라이브에 공간이 부족합니다. 공간을 확보한 뒤 UT Stems를 다시 시작하세요.',
    'Using {file}.': '{file}을(를) 사용합니다.', 'Install from the file': '파일에서 설치', 'Download and update': '내려받아 업데이트',
    'Download started': '내려받기 시작', 'The engine is installed': '엔진이 설치됐습니다', 'Starting UT Stems…': 'UT Stems 시작하는 중…',
    'No graphics adapter reported': '그래픽 어댑터 정보 없음', 'Update the processing engine': '처리 엔진 업데이트',
    'This version of UT Stems needs engine {app}; the installed engine is {installed}.': '이 UT Stems에는 엔진 {app}이 필요한데 설치된 엔진은 {installed}입니다.',
    'older': '이전 버전', 'Engine {version} · {edition} installed': '엔진 {version} · {edition} 설치됨',
    'Downloading · {done} of {total}': '내려받는 중 · {total} 중 {done}', ' · {min} min left': ' · {min}분 남음', 'Downloading the engine…': '엔진 내려받는 중…',
    'Checking the file…': '파일 확인 중…', 'Unpacking · {done} of {total}': '압축 푸는 중 · {total} 중 {done}', 'Unpacking the engine…': '엔진 압축 푸는 중…', 'Could not start: {error}': '시작할 수 없습니다: {error}',
  },
  zh: {
    'Theme: light, dark, 1 or 2': '主题：浅色、深色、1、2',
    'Queue': '队列', 'Clear finished': '清除已完成', 'Songs': '歌曲',
    'Choose audio files': '选择音频文件', 'Drop audio files here': '将音频文件拖到这里', 'Let go to add them': '松开即可添加',
    'or': '或', 'choose files': '选择文件', '· paste a YouTube link in the panel': '· 在面板中粘贴 YouTube 链接',
    'MP3 · WAV · FLAC · M4A · YouTube. Add as many songs as you like; they are separated one after another.': 'MP3 · WAV · FLAC · M4A · YouTube。想加多少首都可以，会依次分离。',
    'Separating': '分离中', 'Working': '处理中', 'Separation progress': '分离进度', 'Steps': '步骤',
    'A 4-minute song takes about a minute. The very first run also downloads the model (about 670 MB).': '4 分钟的歌曲大约需要 1 分钟。首次运行还会下载模型（约 670 MB）。',
    'No supported GPU was found, so this runs on the CPU and takes a while. You can keep using the PC in the meantime.': '未找到受支持的 GPU，将使用 CPU 处理，需要较长时间。期间可以照常使用电脑。',
    'Separated': '已分离', 'Rename the song': '重命名歌曲', 'Song name': '歌曲名', 'Save': '保存', 'Cancel': '取消',
    'Open folder': '打开文件夹', 'Play': '播放', 'Song position': '播放位置', 'Stems': '音轨',
    'S plays one stem alone, M mutes it. Click a waveform to jump to that point.': 'S 只播放该音轨，M 将其静音。点击波形可跳到该位置。',
    'Drop audio files to add them': '拖入音频文件即可添加',
    'Source': '来源', 'YouTube link or audio file path': 'YouTube 链接或音频文件路径', 'Paste a YouTube link…': '粘贴 YouTube 链接…',
    'Add': '添加', 'Choose files…': '选择文件…', 'All': '全选', 'None': '全不选', 'Stems to write': '要写出的音轨',
    'Others collects everything that is not in a selected stem.': '"其他"包含未归入所选音轨的所有声音。',
    'Output': '输出', 'Output folder': '输出文件夹', 'Change': '更改', 'Format': '格式', 'Auto': '自动', 'by the source': '按来源', '24-bit': '24 位',
    'Files are written as song_instrument.mp3 or .wav. Auto writes WAV for a WAV, FLAC or AIFF file and MP3 for everything else, including YouTube.': '文件以"歌曲名_乐器.mp3"或".wav"保存。自动模式下，WAV、FLAC、AIFF 来源输出 WAV，其余（包括 YouTube）输出 MP3。',
    'Model': '模型', 'best quality': '质量最佳', 'faster': '更快', 'Chunk blending': '分块混合', 'Standard': '标准', 'Smoother': '更平滑', 'about 2× slower': '约慢 2 倍',
    'Files': '文件', 'Auto title': '自动标题', 'A YouTube song takes the video title unless you renamed it': 'YouTube 歌曲使用视频标题，除非你已重命名',
    'Keep original MP3': '保留原始 MP3', 'Keep the downloaded song next to the stems. Your own files are never deleted': '将下载的歌曲与音轨放在一起。你自己的文件绝不会被删除',
    'Language': '语言', 'Follows the Windows display language when set to Auto.': '设为"自动"时跟随 Windows 显示语言。',
    'Separate stems': '分离音轨', 'Connecting…': '正在连接…', 'Progress': '进度', 'Notifications': '通知', 'Dismiss': '关闭', 'Install': '安装',
    'No supported GPU: on the CPU this model takes about 25 minutes for a 4-minute song. HT-Demucs 6s is much faster.': '没有受支持的 GPU：此模型在 CPU 上处理 4 分钟的歌曲约需 25 分钟。HT-Demucs 6s 快得多。',
    'No supported GPU: on the CPU this model takes about 2 minutes for a 4-minute song.': '没有受支持的 GPU：此模型在 CPU 上处理 4 分钟的歌曲约需 2 分钟。',
    'Vocals': '人声', 'Bass': '贝斯', 'Drums': '鼓', 'Guitars': '吉他', 'Piano': '钢琴', 'Others': '其他',
    'silent': '静音', 'SILENT': '静音', 'Loudness compared with the whole song': '相对整首歌的响度',
    'Solo {stem}': '独奏{stem}', 'Mute {stem}': '静音{stem}', '{stem} volume': '{stem}音量',
    '{time} · {n} stems · {model} · separated in {s} s · {folder}': '{time} · {n} 条音轨 · {model} · 用时 {s} 秒 · {folder}',
    'Could not play the stems: {error}': '无法播放音轨：{error}',
    'Ready': '就绪', 'In the queue': '排队中', 'Failed': '失败', 'Cancelled': '已取消', '{n} stems · {s} s': '{n} 条音轨 · {s} 秒',
    'Renamed to {name}. The files have the new name.': '已重命名为"{name}"，文件也已改名。',
    'Preparing': '准备', 'Downloading from YouTube': '从 YouTube 下载', 'Reading audio': '读取音频', 'Loading model': '加载模型',
    'Cancelling': '正在取消', 'Writing': '写入', 'Downloading': '下载中', '{step} done': '{step} 完成', 'Writing {stem}': '写入{stem}',
    'Rename the song and its files (or double-click the song)': '重命名歌曲及其文件（也可双击歌曲）', 'Rename (or double-click the song)': '重命名（也可双击歌曲）',
    'Rename {title}': '重命名{title}', 'Remove {title}': '移除{title}', 'Separate {n} songs': '分离 {n} 首',
    'The processing engine stopped. Restart the app.': '处理引擎已停止。请重新启动应用。',
    '1 song ready. Press Separate stems.': '1 首歌曲已就绪。请按"分离音轨"。', '{n} songs ready. Press Separate {n} songs.': '{n} 首歌曲已就绪。请按"分离 {n} 首"。',
    'Ready to separate': '可以分离了', 'Pick the stems you want, then press Separate.': '选择想要的音轨，然后按"分离"。',
    'It starts when the songs before it are finished.': '前面的歌曲完成后会自动开始。', 'This song could not be separated': '这首歌曲无法分离',
    'Get it': '获取', 'UT Stems {version} is available (you have {current}).': 'UT Stems {version} 已发布（当前为 {current}）。', 'Installing…': '正在安装…',
    'Paste a YouTube link or a file path…': '粘贴 YouTube 链接或文件路径…', 'Could not connect to the processing engine: {error}': '无法连接处理引擎：{error}',
    'Paste a YouTube link or choose audio files.': '粘贴 YouTube 链接或选择音频文件。',
    'Downloading audio from YouTube…': '正在从 YouTube 下载音频…', 'Reading audio…': '正在读取音频…', 'Loading the separation model…': '正在加载分离模型…',
    'Separating stems…': '正在分离音轨…', 'Writing {stem}…': '正在写入{stem}…', 'Done in {s} s · {n} stems': '用时 {s} 秒 · {n} 条音轨', 'Starting': '开始',
    ' · {n} more in the queue': ' · 队列中还有 {n} 首',
    'Select at least one stem.': '请至少选择一条音轨。', 'Add a song first.': '请先添加歌曲。',
    'Paste a YouTube link or choose an audio file.': '粘贴 YouTube 链接或选择音频文件。', 'File not found: {path}': '找不到文件：{path}',
    'Type a name for the song.': '请输入歌曲名。', 'Wait until the song is separated, then rename it.': '请等分离完成后再重命名。',
    'A song that could not be separated cannot be renamed.': '分离失败的歌曲无法重命名。', 'Cancel the song before removing it.': '请先取消再移除。',
    'There is no output folder to open yet.': '还没有可打开的输出文件夹。',
    'The processing engine is missing. Start UT Stems again to set it up.': '缺少处理引擎。请重新启动 UT Stems 进行设置。',
    'The processing engine did not start in time.': '处理引擎未能及时启动。',
    'This copy runs without the installer; download the new version from the release page.': '此副本未经安装程序运行，请从发布页面下载新版本。',
    'The update could not be installed: {error}': '无法安装更新：{error}', 'Cancelled.': '已取消。',
    'First start': '首次启动', 'Get the processing engine': '获取处理引擎',
    'UT Stems separates songs with PyTorch models that run on this PC. They are not in the installer; they are downloaded once, for the graphics card in this PC.': 'UT Stems 使用在本机运行的 PyTorch 模型分离歌曲。模型不包含在安装程序中，会根据本机显卡只下载一次。',
    'Graphics in this PC': '本机显卡', 'Installs to': '安装到', 'Edition': '版本', 'CPU only': '仅 CPU',
    'about 1.7 GB': '约 1.7 GB', 'about 1.2 GB': '约 1.2 GB', 'about 200 MB': '约 200 MB',
    'Download the processing engine': '下载处理引擎', 'Download and install': '下载并安装', 'Starting…': '正在开始…',
    'Already have the file?': '已有文件？', 'Use a downloaded archive…': '使用已下载的压缩包…', 'Nothing is installed yet.': '尚未安装任何内容。',
    'For NVIDIA GPUs (GTX 10 series or newer, current driver). Also runs on the CPU when no GPU is found, so it is a safe choice for any PC.': '适用于 NVIDIA GPU（GTX 10 系列或更新，最新驱动）。没有 GPU 时也会用 CPU 运行，任何电脑都可放心选择。',
    'For Intel Arc A/B series and the Arc graphics in Core Ultra laptops, with a recent Intel graphics driver.': '适用于 Intel Arc A/B 系列以及 Core Ultra 笔记本的 Arc 显卡，需要较新的 Intel 显卡驱动。',
    'For PCs without a supported GPU (or with an AMD GPU). Separation is slower: about 25 minutes for a 4-minute song with the best model.': '适用于没有受支持 GPU（或使用 AMD GPU）的电脑。分离较慢：最佳模型处理 4 分钟歌曲约需 25 分钟。',
    'Needs about {need} free while installing.': '安装期间需要约 {need} 可用空间。', '{free} is free.': '当前可用 {free}。',
    'Not enough space on this drive. Make room, then start UT Stems again.': '此驱动器空间不足。请腾出空间后重新启动 UT Stems。',
    'Using {file}.': '将使用 {file}。', 'Install from the file': '从文件安装', 'Download and update': '下载并更新',
    'Download started': '已开始下载', 'The engine is installed': '引擎已安装', 'Starting UT Stems…': '正在启动 UT Stems…',
    'No graphics adapter reported': '未报告显卡', 'Update the processing engine': '更新处理引擎',
    'This version of UT Stems needs engine {app}; the installed engine is {installed}.': '此版本的 UT Stems 需要引擎 {app}，已安装的是 {installed}。',
    'older': '旧版本', 'Engine {version} · {edition} installed': '已安装引擎 {version} · {edition}',
    'Downloading · {done} of {total}': '下载中 · {done} / {total}', ' · {min} min left': ' · 剩余 {min} 分钟', 'Downloading the engine…': '正在下载引擎…',
    'Checking the file…': '正在校验文件…', 'Unpacking · {done} of {total}': '解压中 · {done} / {total}', 'Unpacking the engine…': '正在解压引擎…', 'Could not start: {error}': '无法启动：{error}',
  },
};

let choice = '';     // '' follows Windows; otherwise one of LANGUAGES
let current = 'en';  // the language in use

/** The language Windows shows, when it is one of ours; English otherwise. */
export function detect() {
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    const code = String(tag || '').toLowerCase().slice(0, 2);
    if (LANGUAGES.includes(code)) return code;
  }
  return 'en';
}

/** Switches the language: a saved choice, or '' to follow Windows. Re-translates the static text. */
export function setLanguage(saved) {
  choice = LANGUAGES.includes(saved) ? saved : '';
  current = choice || detect();
  document.documentElement.lang = current === 'zh' ? 'zh-CN' : current;
  try { if (choice) localStorage.setItem('ut-stems-language', choice); else localStorage.removeItem('ut-stems-language'); } catch {}
  applyStatic();
}

export function language() { return current; }
export function languageChoice() { return choice; }

/** The saved choice from the last start, so the first paint is already in the right language. */
export function storedChoice() {
  try { return localStorage.getItem('ut-stems-language') || ''; } catch { return ''; }
}

/** Translates one of the interface's strings; {name} fields are filled from vars. */
export function t(key, vars) {
  let text = DICT[current]?.[key] ?? key;
  if (vars) for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value));
  return text;
}

const STEM = {vocals: 'Vocals', bass: 'Bass', drums: 'Drums', guitars: 'Guitars', piano: 'Piano', others: 'Others'};
const stemName = stem => t(STEM[stem] ?? stem);

// Messages that arrive from the engine or the shell, with their variable parts.
const PATTERNS = [
  [/^(.*) · (\d+) more in the queue$/, m => tm(m[1]) + t(' · {n} more in the queue', {n: m[2]})],
  [/^(Downloading audio from YouTube…|Separating stems…) (\d+%)$/, m => `${t(m[1])} ${m[2]}`],
  [/^Writing (\w+)…$/, m => t('Writing {stem}…', {stem: stemName(m[1])})],
  [/^Writing (\w+)$/, m => t('Writing {stem}', {stem: stemName(m[1])})],
  [/^Done in (\d+) s · (\d+) stems$/, m => t('Done in {s} s · {n} stems', {s: m[1], n: m[2]})],
  [/^File not found: (.*)$/s, m => t('File not found: {path}', {path: m[1]})],
  [/^The update could not be installed: (.*)$/s, m => t('The update could not be installed: {error}', {error: m[1]})],
];

/** Translates a message from the engine or the shell when it is one we know; otherwise returns it as is. */
export function tm(message) {
  if (!message || current === 'en') return message ?? '';
  const direct = DICT[current][message];
  if (direct) return direct;
  for (const [pattern, translate] of PATTERNS) {
    const match = pattern.exec(message);
    if (match) return translate(match);
  }
  return message;
}

/** Translates the markup: [data-i18n] text and [data-i18n-attr="title placeholder …"] attributes.
    The English text is read from the element the first time and kept as the key. */
export function applyStatic(root = document) {
  for (const element of root.querySelectorAll('[data-i18n]')) {
    if (!element.dataset.i18n) element.dataset.i18n = element.textContent.trim();
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of root.querySelectorAll('[data-i18n-attr]')) {
    for (const attribute of element.dataset.i18nAttr.split(/\s+/)) {
      const key = `data-i18n-${attribute}`;
      if (!element.hasAttribute(key)) element.setAttribute(key, element.getAttribute(attribute) ?? '');
      element.setAttribute(attribute, t(element.getAttribute(key)));
    }
  }
}
