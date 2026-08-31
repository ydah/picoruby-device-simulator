# PicoSim

PicoRuby のコードをブラウザで実行し、GPIO や周辺部品の挙動を Canvas で確認できるマイコン・シミュレータです。同じ Ruby ソースを Web Serial で R2P2 実機へ転送できます。

これは RP2040 のエミュレータではありません。PicoRuby の周辺 API を再現するシミュレータであり、サイクル精度、電流・電圧降下、割り込みの厳密なタイミング、PIO は再現しません。

## 起動

Node.js 20 以上が必要です。

```sh
npm ci
npm run dev
```

表示された URL をブラウザで開きます。シミュレーションは主要ブラウザで動作します。実機転送には Web Serial 対応の Chrome または Edge と、R2P2 を導入した Raspberry Pi Pico が必要です。

## 使い方

1. `main.rb` を編集し、「実行」を押します。
2. ボタン部品は Canvas 上で押せます。可変抵抗、温度、湿度はボード下の入力で変更できます。
3. 速度はリアルタイム、×10、ステップから選べます。ステップでは「次のイベント」で次の GPIO/出力イベントまで進みます。
4. `board.yml` を編集して「配線を適用」を押すと、部品と配線を差し替えられます。
5. Chrome / Edge では「実機へ転送」からポートを選ぶと、ソースを `main.rb` として保存して実行します。

エディタ内容は `localStorage` に保存されます。「共有」はソースを URL のフラグメントへ埋め込み、クリップボードへコピーします。ソースはサーバへ送信されません。

## シミュレートする API と部品

- `GPIO`: 入出力、プルアップ/ダウン、ピン履歴
- `PWM`: 周波数、デューティ比、周期、パルス幅
- `ADC`: 16 bit raw 値と 3.3 V 換算
- `I2C`: アドレス別デバイスルーティング
- `SPI`: write/read/transfer とチップセレクト
- LED、タクトスイッチ、可変抵抗、サーボ
- SSD1306: ページ/水平アドレッシング、描画 API、反転、表示 ON/OFF
- SK6812: `output` と色配列の `show`
- AHT25: 温湿度読み出し

シミュレータ用クラスは [src/simhal.rb](src/simhal.rb) で、現行 PicoRuby 4 の定数値と公開シグネチャに合わせています。`require 'gpio'` などを含むユーザーコードは変更せず実機へ転送できます。

## `board.yml`

部品は `id`、`type`、Canvas 上の `at: [x, y]` を持ちます。`connections` は部品端子と `gpioN`、`gnd`、`3v3` を接続します。

```yaml
board: pico_w
parts:
  - id: led1
    type: led
    color: "#ef4444"
    at: [345, 105]
connections:
  - [led1.anode, gpio15]
  - [led1.cathode, gnd]
```

対応する `type` は `led`、`button`、`potentiometer`、`ssd1306`、`sk6812`、`aht25`、`servo` です。GND/電源の未接続と、通常信号 GPIO の重複を警告します。I2C の SDA/SCL 共有は重複警告の対象外です。

## 実機転送

「実機へ転送」のクリック中に `navigator.serial.requestPort()` を呼ぶため、ブラウザのユーザー操作要件を満たします。115200 baud で接続し、Ctrl-C で実行中処理を止め、Ctrl-B で現行 R2P2 の RBTP 転送モードへ入ります。`/home/main.rb` を480バイトずつ送信して応答とCRCを検証した後、そのファイルを実行します。

シミュレータでの成功は実機動作を保証しません。特にピン配線、電源、センサ個体差、PWM 周波数誤差、処理時間は実機で再確認してください。

## テストとビルド

```sh
npm test
npm run build
```

ブラウザスモークテストは、開発サーバと remote debugging port 9222 の Chrome を起動してから実行します。

```sh
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --headless=new --remote-debugging-port=9222 --remote-allow-origins='*' \
  --user-data-dir=/tmp/picosim-chrome http://127.0.0.1:5173
npm run test:browser
```

このテストは公式 PicoRuby wasm 上で GPIO、ADC、PWM、I2C、SSD1306、AHT25、SK6812、ボタン、サーボ、ステップ実行を通します。
`PICOSIM_3G_MAX_MS=3000` を付けると、Fast 3G（1.6 Mbps、150 ms遅延）のコールドロード予算も検査します。

`npm run build` の出力は `dist/` だけで完結する静的サイトです。`main` への push では GitHub Pages 用ワークフローがビルド・公開します。リポジトリの Pages 設定で Source を GitHub Actions にしてください。

## 既知の差異

- ステップ実行は次の GPIO またはシリアル出力イベントまで進めます。ハードウェアイベントのない無限ループには停止点がありません。
- SSD1306 の未使用コマンドは無視します。文字はブラウザの monospace フォントで近似し、実機 BDF フォントの字形とは一致しません。
- SK6812 は GPIO ビットストリームを解析せず、シム用 `SK6812` クラスから色配列を直接渡します。
- SPI は接続デバイスを登録しない場合、送信長と同じゼロ列を返します。
- Web Serial は HTTPS または localhost の secure context でのみ利用できます。
- 現在のwasmは2.1 MB（gzip約886 KB）あり、Fast 3Gでのコールドロード3秒目標は未達です。達成には上流wasmの縮小ビルドが必要です。
