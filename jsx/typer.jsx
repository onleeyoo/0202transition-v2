/* 0202Transition typer (test) host, from the 0202Typewriter host (ExtendScript, ES3, ASCII only). Exposes T0202TWX.
   Premiere 26 can't write Source Text from script, so every keystroke is a real text clip built from FCP XML
   (cloned from the selected text clip, or generated), imported as a sequence and nested on the timeline. */
var T0202TWX = (function () {
    var TPS = 254016000000, lastErr = "";
    var SEP = ($.os && /windows/i.test($.os)) ? "\\" : "/";
    var PREFIX = "\uD0C0\uC790_";            /* nested sequences are named "<prefix><text>" so we can find them again */
    var BIN = "0202 \uD0C0\uC790";

    function seqInfo(seq) { var tb = Number(seq.timebase); return { tpf: tb, fps: TPS / tb, w: Number(seq.frameSizeHorizontal), h: Number(seq.frameSizeVertical) }; }
    function selectedClips(seq) {
        var out = [];
        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var tr = seq.videoTracks[t];
            for (var c = 0; c < tr.clips.numItems; c++) if (tr.clips[c].isSelected()) out.push({ t: t, c: c, clip: tr.clips[c] });
        }
        return out;
    }
    /* Windows: Korean user name / 8.3 short temp path -> XML export writes nothing there; use C:\\Users\\Public */
    function safeBase() {
        var t = Folder.temp.fsName;
        if (SEP === "\\" && /[^\x00-\x7F]|~/.test(t)) {
            var pub = $.getenv("PUBLIC") || "C:\\Users\\Public";
            var pf = new Folder(pub);
            if (pf.exists && !/[^\x00-\x7F]/.test(pf.fsName)) return pf.fsName;
        }
        return t;
    }
    function tmpDir() { var d = new Folder(safeBase() + SEP + "0202Typer"); if (!d.exists) d.create(); return d; }
    function tmpPath(name) { return tmpDir().fsName + SEP + name; }
    function textCount(clip) { var n = 0; for (var i = 0; i < clip.components.numItems; i++) if (clip.components[i].matchName === "AE.ADBE Text") n++; return n; }
    function isText(clip) { return textCount(clip) > 0; }
    function nestSeq(clip) {
        try {
            var pi = clip.projectItem;
            if (!pi || !pi.isSequence() || pi.name.indexOf(PREFIX) !== 0) return null;
            for (var s = 0; s < app.project.sequences.numSequences; s++) { var q = app.project.sequences[s]; if (q.projectItem && q.projectItem.nodeId === pi.nodeId) return q; }
        } catch (e) {}
        return null;
    }
    function waitFile(f) { for (var w = 0; w < 300 && !f.exists; w++) $.sleep(100); return f.exists; }   /* long sequences can take >5s to export */
    function enc(s) { return encodeURIComponent(String(s)); }

    /* what is selected: none | text | typer | other  (cheap, polled by the panel) */
    function sel() {
        var seq = app.project.activeSequence;
        if (!seq) return "noseq";
        var s = selectedClips(seq);
        if (!s.length) return "none";
        var cl = s[0].clip;
        if (nestSeq(cl)) return "typer|" + enc(cl.name);
        if (textCount(cl) > 1) return "multi|" + enc(cl.name);
        if (isText(cl)) return "text|" + enc(cl.name);
        return "other";
    }
    /* export what the panel needs as FCP XML: the active sequence (text clip) or the nested typer sequence */
    function probe() {
        var seq = app.project.activeSequence;
        if (!seq) return "ERR|noseq";
        var s = selectedClips(seq), info = seqInfo(seq);
        if (!s.length) return "OK|none|" + info.tpf + "|" + seq.getPlayerPosition().ticks + "|" + info.w + "|" + info.h;
        var cl = s[0].clip, ns = nestSeq(cl), f = new File(tmpPath("src_" + new Date().getTime() + ".xml"));
        if (ns) {
            if (!ns.exportAsFinalCutProXML(f.fsName, 1) || !waitFile(f)) return "ERR|export";
            return "OK|typer|" + enc(f.fsName) + "|" + s[0].t + "|" + cl.start.ticks + "|" + cl.end.ticks + "|" + info.tpf + "|" + info.w + "|" + info.h;
        }
        if (textCount(cl) > 1) return "OK|multi";
        if (!isText(cl)) return "OK|other|" + info.tpf + "|" + seq.getPlayerPosition().ticks + "|" + info.w + "|" + info.h;
        if (!seq.exportAsFinalCutProXML(f.fsName, 1) || !waitFile(f)) return "ERR|export";
        return "OK|text|" + enc(f.fsName) + "|" + s[0].t + "|" + cl.start.ticks + "|" + cl.end.ticks + "|" + info.tpf + "|" + info.w + "|" + info.h;
    }
    function freeTrack(seq, from, st, en) {
        for (var ti = from; ti < seq.videoTracks.numTracks; ti++) {
            var tr = seq.videoTracks[ti], free = true;
            for (var c = 0; c < tr.clips.numItems; c++) { var k = tr.clips[c]; if (Number(k.start.ticks) < en && Number(k.end.ticks) > st) { free = false; break; } }
            if (free) return ti;
        }
        return -1;
    }
    /* o: { path, start(ticks), frames, track, mode: "above" | "replace" | "free", hideSrc } */
    function place(o) {
        var seq = app.project.activeSequence;
        if (!seq) return "ERR|noseq";
        var info = seqInfo(seq), path = decodeURIComponent(o.path), st = Number(o.start), tr = Number(o.track);
        st = Math.round(st / info.tpf) * info.tpf;
        var en = st + Number(o.frames) * info.tpf, tIdx;
        if (o.mode === "replace") tIdx = tr;
        else tIdx = freeTrack(seq, o.mode === "above" ? tr + 1 : 0, st, en);
        if (tIdx < 0) { try { new File(path).remove(); } catch (e0) {} return "ERR|notrack"; }
        var before = {}, s0, nseq = null;
        for (s0 = 0; s0 < app.project.sequences.numSequences; s0++) before[app.project.sequences[s0].sequenceID] = 1;
        app.project.importFiles([path], true, app.project.rootItem, false);
        try { new File(path).remove(); } catch (eR) {}
        for (s0 = 0; s0 < app.project.sequences.numSequences; s0++) { var q = app.project.sequences[s0]; if (!before[q.sequenceID]) nseq = q; }
        if (!nseq) return "ERR|import";
        try {
            var bin = null, root = app.project.rootItem;
            for (var b = 0; b < root.children.numItems; b++) if (root.children[b].type === 2 && root.children[b].name === BIN) bin = root.children[b];
            if (!bin) bin = root.createBin(BIN);
            if (bin) nseq.projectItem.moveBin(bin);
        } catch (eB) {}
        /* plain text clips: Text Position = left end of the baseline; centre the final line */
        if (o.px !== undefined) {
            try {
                var ntr = nseq.videoTracks[0];
                for (var m = 0; m < ntr.clips.numItems; m++) {
                    var cl = ntr.clips[m];
                    for (var ci = 0; ci < cl.components.numItems; ci++) {
                        var cp = cl.components[ci];
                        if (cp.matchName !== "AE.ADBE Text") continue;
                        /* "Position" is localised (KO / JA Premiere); it is param #2 of the Text component */
                        var pp = null;
                        for (var pi = 0; pi < cp.properties.numItems; pi++) if (/^(Position|\uC704\uCE58|\u4F4D\u7F6E)$/.test(cp.properties[pi].displayName)) { pp = cp.properties[pi]; break; }
                        if (!pp && cp.properties.numItems > 2) pp = cp.properties[2];
                        if (pp) pp.setValue([o.px, o.py], 1);
                    }
                }
            } catch (eP) {}
        }
        var tm = new Time(); tm.ticks = String(st);
        seq.videoTracks[tIdx].overwriteClip(nseq.projectItem, tm);
        var off = 0;
        if (o.hideSrc && o.mode === "above") {
            var rt = seq.videoTracks[tr];
            for (var r = 0; r < rt.clips.numItems; r++) { var rc = rt.clips[r]; if (Number(rc.start.ticks) <= st && Number(rc.end.ticks) > st) { try { rc.disabled = true; off++; } catch (eD) {} break; } }
        }
        try { app.project.openSequence(seq.sequenceID); } catch (eO) {}
        return "OK|" + (tIdx + 1) + "|" + off;
    }
    function nestFrame() {
        var seq = app.project.activeSequence;
        if (!seq) return "ERR|noseq";
        var s = selectedClips(seq); if (!s.length) return "ERR|nosel";
        var ns = nestSeq(s[0].clip); if (!ns) return "ERR|notyper";
        var info = seqInfo(ns), base = tmpPath("box_" + new Date().getTime()), out = "";
        try {
            app.project.openSequence(ns.sequenceID);
            ns.setPlayerPosition(String(Math.max(0, Number(ns.end) - 2 * info.tpf)));
            app.enableQE();
            var qs = qe.project.getActiveSequence();
            qs.exportFramePNG(qs.CTI.timecode, base);
            var png = new File(base + ".png");
            for (var w = 0; w < 80 && !png.exists; w++) $.sleep(50);
            out = png.exists ? png.fsName : "";
        } catch (e) { lastErr = "nestFrame " + e.message; }
        try { app.project.openSequence(seq.sequenceID); } catch (eO) {}
        return out ? "OK|" + enc(out) + "|" + info.w + "|" + info.h : "ERR|frame";
    }
    /* import a one-clip generator XML, export it back as FCP XML (now with a real Premiere Source Text), drop the temp sequence */
    function roundTrip(o) {
        var path = decodeURIComponent(o.path), before = {}, s0, nseq = null;
        for (s0 = 0; s0 < app.project.sequences.numSequences; s0++) before[app.project.sequences[s0].sequenceID] = 1;
        var cur = app.project.activeSequence;
        app.project.importFiles([path], true, app.project.rootItem, false);
        try { new File(path).remove(); } catch (eR) {}
        for (s0 = 0; s0 < app.project.sequences.numSequences; s0++) { var q = app.project.sequences[s0]; if (!before[q.sequenceID]) nseq = q; }
        if (!nseq) return "ERR|import";
        var f = new File(tmpPath("rt_" + new Date().getTime() + ".xml"));
        var ok = nseq.exportAsFinalCutProXML(f.fsName, 1) && waitFile(f);
        try { app.project.deleteSequence(nseq); } catch (eD) {}
        try { if (cur) app.project.openSequence(cur.sequenceID); } catch (eO) {}
        return ok ? "OK|" + enc(f.fsName) : "ERR|export";
    }

    /* render frame 0..n-1 of a one-frame-per-step nest to PNG (for measuring where each piece sits); the temp sequence is removed */
    function frames(o) {
        var path = decodeURIComponent(o.path), before = {}, s0, nseq = null, cur = app.project.activeSequence;
        for (s0 = 0; s0 < app.project.sequences.numSequences; s0++) before[app.project.sequences[s0].sequenceID] = 1;
        app.project.importFiles([path], true, app.project.rootItem, false);
        try { new File(path).remove(); } catch (eR) {}
        for (s0 = 0; s0 < app.project.sequences.numSequences; s0++) { var q = app.project.sequences[s0]; if (!before[q.sequenceID]) nseq = q; }
        if (!nseq) return "ERR|import";
        var base = tmpPath("mf_" + new Date().getTime()), ok = 0;
        try {
            app.project.openSequence(nseq.sequenceID);
            app.enableQE();
            var qs = qe.project.getActiveSequence(), tpf = Number(nseq.timebase);
            for (var i = 0; i < o.n; i++) {
                nseq.setPlayerPosition(String(i * tpf));
                if (qs.exportFramePNG(qs.CTI.timecode, base + "_" + i)) ok++;
            }
        } catch (e) { lastErr = "frames " + e.message; }
        try { app.project.deleteSequence(nseq); } catch (eD) {}
        try { if (cur) app.project.openSequence(cur.sequenceID); } catch (eO) {}
        return ok === o.n ? "OK|" + enc(base) : "ERR|frames|" + ok;
    }
    function err() { return lastErr; }
    /* leftovers from crashed runs never pile up in the temp folder */
    function clean() {
        var n = 0;
        try { var fs = tmpDir().getFiles(function (f) { return f instanceof File && /\.(xml|png)$/i.test(f.name); }); for (var i = 0; i < fs.length; i++) { try { if (fs[i].remove()) n++; } catch (e) {} } } catch (e2) {}
        return "OK|" + n;
    }

    function safe(fn, name) {
        return function () {
            try { return fn.apply(null, arguments); } catch (e) { lastErr = name + ": " + e.message + " (line " + e.line + ")"; return "ERR|" + lastErr; }
        };
    }
    return { ping: function () { return "OK|" + app.version; }, sel: safe(sel, "sel"), probe: safe(probe, "probe"), place: safe(place, "place"), tmpPath: safe(tmpPath, "tmpPath"), clean: safe(clean, "clean"), nestFrame: safe(nestFrame, "nestFrame"), roundTrip: safe(roundTrip, "roundTrip"), frames: safe(frames, "frames"), err: err };
})();
