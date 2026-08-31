MRuby::CrossBuild.new("picoruby-wasm-sim") do |conf|
  conf.toolchain :clang

  conf.cc.defines << "PICORB_PLATFORM_POSIX"
  conf.cc.defines << "PICORB_PLATFORM_WASM"
  conf.cc.defines << "MRB_TICK_UNIT=4"
  conf.cc.defines << "MRB_TIMESLICE_TICK_COUNT=1"
  conf.cc.defines << "MRB_32BIT"
  conf.cc.defines << "MRB_INT64"
  conf.cc.defines << "MRB_NO_BOXING"
  conf.cc.defines << "MRB_UTF8_STRING"

  conf.cc.command = "emcc"
  conf.linker.command = "emcc"
  conf.archiver.command = "emar"

  conf.picoruby(alloc_estalloc: false)
  conf.gembox "mruby-posix"
  %w[
    mruby-toplevel-ext mruby-object-ext mruby-numeric-ext mruby-kernel-ext
    mruby-string-ext mruby-array-ext mruby-hash-ext mruby-sprintf
    mruby-objectspace mruby-metaprog mruby-math mruby-pack
  ].each do |gem|
    conf.gem gemdir: "#{MRUBY_ROOT}/mrbgems/picoruby-mruby/lib/mruby/mrbgems/#{gem}"
  end
  conf.gem core: "picoruby-json"
  conf.gem core: "picoruby-wasm"
end
