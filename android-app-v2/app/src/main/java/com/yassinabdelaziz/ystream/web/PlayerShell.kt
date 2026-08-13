package com.yassinabdelaziz.ystream.web

/**
 * Minimal HTML host for the provider embed. This is the only web surface in the
 * app: it hosts the third-party video player in an iframe (the same direct-embed
 * model the website uses) and forwards the provider's PLAYER_EVENT postMessages
 * to Android through the JavascriptInterface so progress can be saved.
 */
object PlayerShell {

    fun html(embedUrl: String): String = """
        <!DOCTYPE html>
        <html>
        <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <meta http-equiv="Content-Security-Policy"
              content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-src https:; child-src https:; object-src 'none'; base-uri 'self';">
        <style>
        html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000;}
        #embed{position:fixed;inset:0;width:100%;height:100%;border:0;display:block;}
        </style>
        </head>
        <body>
        <iframe id="embed" src="$embedUrl"
                allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                allowfullscreen></iframe>
        <script>
        window.addEventListener('message', function (e) {
          if (typeof e.data !== 'string') return;
          if (typeof AndroidBridge !== 'undefined') {
            AndroidBridge.onPlayerEvent(e.origin || '', e.data);
          }
        });
        </script>
        </body>
        </html>
    """.trimIndent()
}
