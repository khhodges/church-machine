{pkgs}: {
  deps = [
    pkgs.harfbuzz
    pkgs.freetype
    pkgs.fontconfig
    pkgs.glib
    pkgs.gobject-introspection
    pkgs.cairo
    pkgs.pango
    pkgs.pandoc
  ];
}
