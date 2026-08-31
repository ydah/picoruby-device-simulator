# PicoRuby simulator WASM

`picoruby.mjs` と `picoruby.wasm` は PicoRuby 4.0.3、commit
`33540f66d9aba633d4d3ebd6707d5c12baebb652` の縮小ビルドです。公式の
`picoruby-wasm.rb` から IndexedDB、Funicular、Markdown、DRb、SQLite、DFU、
YAML、MIDIなど、シミュレータで使わないgemを除いています。
WebAudio、Web Bluetooth、PicoRuby側WebSerial、WebSocket、Regexpも含めません。
実機転送はアプリのTypeScript実装がWeb Serialを直接使用します。

再生成には Ruby 2.7 以上、Emscripten、Rake、Brotli が必要です。

```sh
git clone https://github.com/picoruby/picoruby.git
cd picoruby
git checkout 33540f66d9aba633d4d3ebd6707d5c12baebb652
git submodule update --init mrbgems/picoruby-mruby/lib/mruby mrbgems/mruby-compiler mrbgems/mruby-bin-mrbc mrbgems/picoruby-machine/lib/estalloc
git -C mrbgems/mruby-compiler submodule update --init lib/prism
cp /path/to/build_config.rb build_config/picoruby-wasm-sim.rb
git apply --unidiff-zero /path/to/picoruby-wasm.patch
CONFIG=picoruby-wasm-sim rake
cp build/picoruby-wasm-sim/bin/picoruby.js /path/to/picoruby.mjs
cp build/picoruby-wasm-sim/bin/picoruby.wasm /path/to/picoruby.wasm
```

## License

Copyright © 2020 HASUMI Hitoshi

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
