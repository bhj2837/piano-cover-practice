# piano-cover-practice

유튜브 피아노 커버 영상을 막대가 떨어지는 연습 화면으로 바꿔 주는 개인 도구입니다.
PC 에서 링크를 곡 파일로 변환하고, 폰의 웹앱에서 그 파일을 불러와 연습합니다.

## 목차

1. 구성
2. 변환기 설치와 사용
3. 연습 앱
4. 링크로 추가하기 (대기열)
5. 곡 파일 형식
6. 주의

## 1. 구성

| 경로 | 내용 |
|---|---|
| `make_song.py` | 유튜브 링크를 곡 파일(`.pcsong`) 하나로 변환 |
| `transcribe.py` | 오디오를 MIDI 로 인식(Transkun, 비교용 ByteDance)하고 왼손과 오른손 트랙으로 나눔 |
| `hands.py` | 음표마다 왼손과 오른손을 정함. 시간을 따라가며 두 손의 위치를 추적 |
| `eval_hands.py` | 손 분리 정확도 비교(개발용, music21 필요) |
| `worker.py` | 비공개 저장소의 대기열에 들어온 링크를 변환해 같은 저장소에 올림 |
| `app/` | 연습 웹앱(PWA). GitHub Pages 로 배포 |
| `preview.py`, `preview_template.html` | 모델별 인식 결과를 원음과 겹쳐 들어 보는 개발용 미리보기 |

변환 순서는 다음과 같습니다.

1. yt-dlp 로 음원을 받습니다.
2. Transkun 으로 음표를 인식합니다.
3. 왼손과 오른손을 나눕니다. 같이 누른 음은 높이 순으로 늘어놓고 자를 자리를 고르는데, 한 손이 닿는 폭(9도), 손가락 수, 두 손의 엇갈림, 직전 손 위치에서 움직인 거리를 비용으로 따져 가장 싼 쪽을 고릅니다.

   두 단 악보 9곡(음 5,736개)에서 높은음자리표 단을 오른손, 낮은음자리표 단을 왼손으로 보고 비교하면, 가운데 도 고정 분할은 78.2%, 이 방식은 95.1% 가 일치합니다. 단과 손이 늘 같지는 않으므로 절대 정확도가 아니라 비교용 수치입니다.
4. 원음을 1배, 0.75배, 0.5배 속도로 만들어 음표와 함께 한 파일에 담습니다.

## 2. 변환기 설치와 사용

필요한 것은 Python 3.11, [uv](https://docs.astral.sh/uv/), ffmpeg 입니다.

Windows:

```
winget install Gyan.FFmpeg
uv venv -p 3.11 .venv
uv pip install -p .venv -r requirements.txt "ncls==0.0.68"
.venv\Scripts\python make_song.py "https://www.youtube.com/watch?v=..."
```

Windows 에서는 `ncls==0.0.68` 을 함께 지정합니다. transkun 이 쓰는 `ncls` 의 최신판(0.0.71)에는 Windows 용 wheel 이 없어서, Microsoft C++ Build Tools 가 없으면 설치가 실패합니다. 0.0.68 에는 Python 3.11 용 Windows wheel 이 있습니다(3.12 이상용은 없습니다). transkun 은 학습용 코드(`Data.py`)에서만 ncls 를 쓰므로 인식 결과에는 영향이 없습니다.

macOS:

```
brew install ffmpeg
uv venv -p 3.11 .venv
uv pip install -p .venv -r requirements.txt
.venv/bin/python make_song.py "https://www.youtube.com/watch?v=..."
```

결과는 `songs/<영상 제목>.pcsong` 에 생깁니다. 2분 30초 곡 기준으로 인식은 CPU 에서 약 20초, 파일은 약 10MB 입니다.

## 3. 연습 앱

폰 브라우저에서 앱 주소를 열고 홈 화면에 추가하면 앱처럼 실행됩니다. 한 번 연 뒤에는 인터넷 없이도 열립니다.

1. 곡 파일을 폰으로 옮깁니다(클라우드 드라이브, 메신저 등).
2. 앱에서 「파일」 버튼으로 곡 파일을 고릅니다. 4절의 링크 방식을 쓰면 이 단계가 없습니다. 곡은 그 기기의 브라우저 저장소에만 저장됩니다.
3. 곡을 눌러 연습 화면을 엽니다.

연습 화면 기능은 다음과 같습니다.

- 한 손씩 보기와 듣기
- 속도 1배, 0.75배, 0.5배 (원음의 음높이는 유지)
- 소리 선택: 원음, 변환음, 둘 다, 끄기
- 구간 반복: 버튼을 한 번 누르면 시작점, 두 번 누르면 끝점, 세 번 누르면 해제
- 화면을 누르면 재생과 정지
- 설정: 막대 길이(건반을 누른 길이 또는 페달까지 포함한 길이), 떨어지는 속도, 재생 전 카운트다운, 싱크 보정

## 4. 링크로 추가하기 (대기열)

파일을 옮기지 않고 앱에서 링크만 넣는 방식입니다. 비공개 GitHub 저장소 하나를 폰과 PC 사이의 우편함으로 씁니다.

1. 앱에 유튜브 링크를 넣거나, 유튜브 앱의 공유 메뉴에서 이 앱을 고릅니다. 공유 메뉴는 앱을 홈 화면에 추가한 뒤에 나타납니다.
2. 앱이 저장소의 `queue/<영상ID>.json` 에 링크를 적습니다.
3. PC 의 `worker.py` 가 대기열을 변환해 `songs/<영상ID>.pcsong` 으로 올립니다. 실패하면 `failed/<영상ID>.json` 에 이유를 남깁니다.
4. 앱을 열면 새 곡을 받아 목록에 넣습니다. 기다리는 곡이 있으면 30초마다 다시 확인합니다.

PC 가 꺼져 있을 때 넣은 링크는 PC 가 켜진 뒤 변환됩니다. 유튜브는 데이터센터 IP 의 다운로드를 자주 막기 때문에 변환은 클라우드가 아니라 집 PC 에서 합니다.

### 준비

비공개 저장소를 만듭니다(예: `piano-cover-songs`). 그다음 폰에 넣을 토큰을 만듭니다.

1. GitHub 설정의 Fine-grained personal access token 화면을 엽니다.
2. Repository access 에서 이 저장소 하나만 고릅니다.
3. Permissions 의 Contents 를 Read and write 로 둡니다.
4. 앱의 설정 화면에 저장소 이름과 토큰을 넣습니다. 토큰은 그 기기의 브라우저에만 저장됩니다.

PC 에서는 `git` 이 그 저장소에 push 할 수 있어야 합니다(`gh auth login` 등).

### worker 실행

한 번만 처리하고 끝내기:

```
.venv\Scripts\python worker.py --repo <계정>/piano-cover-songs
```

켜져 있는 동안 60초마다 확인하기:

```
.venv\Scripts\python worker.py --repo <계정>/piano-cover-songs --watch 60
```

Windows 에서 로그인할 때 자동으로 띄우기(경로는 실제 위치로 바꿉니다).

`pythonw.exe` 로 띄우면 worker 가 git, ffmpeg, yt-dlp 를 부를 때마다 콘솔 창이 새로 뜹니다. 그래서 숨긴 콘솔에서 `python.exe` 를 실행하는 스크립트를 거칩니다. 자식 프로세스는 그 숨긴 콘솔을 물려받아 창이 뜨지 않습니다. 다음 내용을 `run-worker.vbs` 로 저장합니다.

```
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\경로"
sh.Run """C:\경로\.venv\Scripts\python.exe"" ""C:\경로\worker.py"" --watch 60", 0, False
```

PowerShell 에서 작업 스케줄러에 등록합니다. 관리자 권한은 필요 없습니다.

```
$action = New-ScheduledTaskAction -Execute wscript.exe -Argument '"C:\경로\run-worker.vbs"'
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
Register-ScheduledTask -TaskName piano-cover-worker -Action $action -Trigger $trigger
```

대기열이 비어 있는 동안에는 `worker.log` 에 아무것도 남지 않습니다. 지금 바로 띄우려면 `Start-ScheduledTask piano-cover-worker`, 자동 실행을 끄려면 `Disable-ScheduledTask piano-cover-worker` 를 실행합니다.

macOS 에서는 `~/Library/LaunchAgents/` 에 `RunAtLoad` 와 `KeepAlive` 를 켠 plist 를 두고 같은 명령을 실행하게 합니다. 진행 기록은 `worker.log` 에 남습니다.

## 5. 곡 파일 형식

```
"PCS1" (4바이트) | JSON 길이 (4바이트, little endian) | JSON | 오디오 바이트
```

JSON 의 키는 다음과 같습니다.

| 키 | 내용 |
|---|---|
| `title`, `source`, `duration` | 영상 제목, 주소, 길이(초) |
| `notes` | `[시작, 건반을 뗀 시각, 음높이, 세기, 손(0 오른손, 1 왼손), 페달까지 포함한 끝]` 의 배열, 시작 시각 순 |
| `audio` | 속도별 mp3 의 `[오프셋, 길이]`. 오프셋은 JSON 이 끝난 지점부터 셉니다 |

## 6. 주의

- 개인 연습용입니다. 커버 연주의 권리는 원곡자와 연주자에게 있으므로 곡 파일과 음원은 이 저장소에 올리지 않습니다(`.gitignore`).
- 인식 결과에는 틀린 음이 섞여 있습니다. 정답 악보와 비교한 정확도 수치는 없습니다.
