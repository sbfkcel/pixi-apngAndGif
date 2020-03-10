(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory(require('pako')) :
    typeof define === 'function' && define.amd ? define(['pako'], factory) :
    (global.PixiApngAndGif = factory(global.pako));
}(this, (function (pako) { 'use strict';

    pako = pako && pako.hasOwnProperty('default') ? pako['default'] : pako;

    var $getExeName = (function (filePath) {
        var aList = filePath.split('.');
        return aList[aList.length - 1];
    });

    // (c) Dean McNamee <dean@gmail.com>, 2013.
    function GifReader(buf) {
        var p = 0;
        // - Header (GIF87a or GIF89a).
        if (buf[p++] !== 0x47 || buf[p++] !== 0x49 || buf[p++] !== 0x46 ||
            buf[p++] !== 0x38 || (buf[p++] + 1 & 0xfd) !== 0x38 || buf[p++] !== 0x61) {
            throw new Error("Invalid GIF 87a/89a header.");
        }
        // - Logical Screen Descriptor.
        var width = buf[p++] | buf[p++] << 8;
        var height = buf[p++] | buf[p++] << 8;
        var pf0 = buf[p++]; // <Packed Fields>.
        var global_palette_flag = pf0 >> 7;
        var num_global_colors_pow2 = pf0 & 0x7;
        var num_global_colors = 1 << (num_global_colors_pow2 + 1);
        var background = buf[p++];
        buf[p++]; // Pixel aspect ratio (unused?).
        var global_palette_offset = null;
        var global_palette_size = null;
        if (global_palette_flag) {
            global_palette_offset = p;
            global_palette_size = num_global_colors;
            p += num_global_colors * 3; // Seek past palette.
        }
        var no_eof = true;
        var frames = [];
        var delay = 0;
        var transparent_index = null;
        var disposal = 0; // 0 - No disposal specified.
        var loop_count = null;
        this.width = width;
        this.height = height;
        while (no_eof && p < buf.length) {
            switch (buf[p++]) {
                case 0x21: // Graphics Control Extension Block
                    switch (buf[p++]) {
                        case 0xff: // Application specific block
                            // Try if it's a Netscape block (with animation loop counter).
                            if (buf[p] !== 0x0b || // 21 FF already read, check block size.
                                // NETSCAPE2.0
                                buf[p + 1] == 0x4e && buf[p + 2] == 0x45 && buf[p + 3] == 0x54 &&
                                    buf[p + 4] == 0x53 && buf[p + 5] == 0x43 && buf[p + 6] == 0x41 &&
                                    buf[p + 7] == 0x50 && buf[p + 8] == 0x45 && buf[p + 9] == 0x32 &&
                                    buf[p + 10] == 0x2e && buf[p + 11] == 0x30 &&
                                    // Sub-block
                                    buf[p + 12] == 0x03 && buf[p + 13] == 0x01 && buf[p + 16] == 0) {
                                p += 14;
                                loop_count = buf[p++] | buf[p++] << 8;
                                p++; // Skip terminator.
                            }
                            else { // We don't know what it is, just try to get past it.
                                p += 12;
                                while (true) { // Seek through subblocks.
                                    var block_size = buf[p++];
                                    // Bad block size (ex: undefined from an out of bounds read).
                                    if (!(block_size >= 0))
                                        throw Error("Invalid block size");
                                    if (block_size === 0)
                                        break; // 0 size is terminator
                                    p += block_size;
                                }
                            }
                            break;
                        case 0xf9: // Graphics Control Extension
                            if (buf[p++] !== 0x4 || buf[p + 4] !== 0)
                                throw new Error("Invalid graphics extension block.");
                            var pf1 = buf[p++];
                            delay = buf[p++] | buf[p++] << 8;
                            transparent_index = buf[p++];
                            if ((pf1 & 1) === 0)
                                transparent_index = null;
                            disposal = pf1 >> 2 & 0x7;
                            p++; // Skip terminator.
                            break;
                        case 0xfe: // Comment Extension.
                            while (true) { // Seek through subblocks.
                                var block_size = buf[p++];
                                // Bad block size (ex: undefined from an out of bounds read).
                                if (!(block_size >= 0))
                                    throw Error("Invalid block size");
                                if (block_size === 0)
                                    break; // 0 size is terminator
                                // console.log(buf.slice(p, p+block_size).toString('ascii'));
                                p += block_size;
                            }
                            break;
                        default:
                            throw new Error("Unknown graphic control label: 0x" + buf[p - 1].toString(16));
                    }
                    break;
                case 0x2c: // Image Descriptor.
                    var x = buf[p++] | buf[p++] << 8;
                    var y = buf[p++] | buf[p++] << 8;
                    var w = buf[p++] | buf[p++] << 8;
                    var h = buf[p++] | buf[p++] << 8;
                    var pf2 = buf[p++];
                    var local_palette_flag = pf2 >> 7;
                    var interlace_flag = pf2 >> 6 & 1;
                    var num_local_colors_pow2 = pf2 & 0x7;
                    var num_local_colors = 1 << (num_local_colors_pow2 + 1);
                    var palette_offset = global_palette_offset;
                    var palette_size = global_palette_size;
                    var has_local_palette = false;
                    if (local_palette_flag) {
                        var has_local_palette = true;
                        palette_offset = p; // Override with local palette.
                        palette_size = num_local_colors;
                        p += num_local_colors * 3; // Seek past palette.
                    }
                    var data_offset = p;
                    p++; // codesize
                    while (true) {
                        var block_size = buf[p++];
                        // Bad block size (ex: undefined from an out of bounds read).
                        if (!(block_size >= 0))
                            throw Error("Invalid block size");
                        if (block_size === 0)
                            break; // 0 size is terminator
                        p += block_size;
                    }
                    frames.push({
                        x: x,
                        y: y,
                        width: w,
                        height: h,
                        has_local_palette: has_local_palette,
                        palette_offset: palette_offset,
                        palette_size: palette_size,
                        data_offset: data_offset,
                        data_length: p - data_offset,
                        transparent_index: transparent_index,
                        interlaced: !!interlace_flag,
                        delay: delay,
                        disposal: disposal
                    });
                    break;
                case 0x3b: // Trailer Marker (end of file).
                    no_eof = false;
                    break;
                default:
                    throw new Error("Unknown gif block: 0x" + buf[p - 1].toString(16));
                    break;
            }
        }
        this.numFrames = function () {
            return frames.length;
        };
        this.loopCount = function () {
            return loop_count;
        };
        this.frameInfo = function (frame_num) {
            if (frame_num < 0 || frame_num >= frames.length)
                throw new Error("Frame index out of range.");
            return frames[frame_num];
        };
        this.decodeAndBlitFrameBGRA = function (frame_num, pixels) {
            var frame = this.frameInfo(frame_num);
            var num_pixels = frame.width * frame.height;
            var index_stream = new Uint8Array(num_pixels); // At most 8-bit indices.
            GifReaderLZWOutputIndexStream(buf, frame.data_offset, index_stream, num_pixels);
            var palette_offset = frame.palette_offset;
            // NOTE(deanm): It seems to be much faster to compare index to 256 than
            // to === null.  Not sure why, but CompareStub_EQ_STRICT shows up high in
            // the profile, not sure if it's related to using a Uint8Array.
            var trans = frame.transparent_index;
            if (trans === null)
                trans = 256;
            // We are possibly just blitting to a portion of the entire frame.
            // That is a subrect within the framerect, so the additional pixels
            // must be skipped over after we finished a scanline.
            var framewidth = frame.width;
            var framestride = width - framewidth;
            var xleft = framewidth; // Number of subrect pixels left in scanline.
            // Output indicies of the top left and bottom right corners of the subrect.
            var opbeg = ((frame.y * width) + frame.x) * 4;
            var opend = ((frame.y + frame.height) * width + frame.x) * 4;
            var op = opbeg;
            var scanstride = framestride * 4;
            // Use scanstride to skip past the rows when interlacing.  This is skipping
            // 7 rows for the first two passes, then 3 then 1.
            if (frame.interlaced === true) {
                scanstride += width * 4 * 7; // Pass 1.
            }
            var interlaceskip = 8; // Tracking the row interval in the current pass.
            for (var i = 0, il = index_stream.length; i < il; ++i) {
                var index = index_stream[i];
                if (xleft === 0) { // Beginning of new scan line
                    op += scanstride;
                    xleft = framewidth;
                    if (op >= opend) { // Catch the wrap to switch passes when interlacing.
                        scanstride = framestride * 4 + width * 4 * (interlaceskip - 1);
                        // interlaceskip / 2 * 4 is interlaceskip << 1.
                        op = opbeg + (framewidth + framestride) * (interlaceskip << 1);
                        interlaceskip >>= 1;
                    }
                }
                if (index === trans) {
                    op += 4;
                }
                else {
                    var r = buf[palette_offset + index * 3];
                    var g = buf[palette_offset + index * 3 + 1];
                    var b = buf[palette_offset + index * 3 + 2];
                    pixels[op++] = b;
                    pixels[op++] = g;
                    pixels[op++] = r;
                    pixels[op++] = 255;
                }
                --xleft;
            }
        };
        // I will go to copy and paste hell one day...
        this.decodeAndBlitFrameRGBA = function (frame_num, pixels) {
            var frame = this.frameInfo(frame_num);
            var num_pixels = frame.width * frame.height;
            var index_stream = new Uint8Array(num_pixels); // At most 8-bit indices.
            GifReaderLZWOutputIndexStream(buf, frame.data_offset, index_stream, num_pixels);
            var palette_offset = frame.palette_offset;
            // NOTE(deanm): It seems to be much faster to compare index to 256 than
            // to === null.  Not sure why, but CompareStub_EQ_STRICT shows up high in
            // the profile, not sure if it's related to using a Uint8Array.
            var trans = frame.transparent_index;
            if (trans === null)
                trans = 256;
            // We are possibly just blitting to a portion of the entire frame.
            // That is a subrect within the framerect, so the additional pixels
            // must be skipped over after we finished a scanline.
            var framewidth = frame.width;
            var framestride = width - framewidth;
            var xleft = framewidth; // Number of subrect pixels left in scanline.
            // Output indicies of the top left and bottom right corners of the subrect.
            var opbeg = ((frame.y * width) + frame.x) * 4;
            var opend = ((frame.y + frame.height) * width + frame.x) * 4;
            var op = opbeg;
            var scanstride = framestride * 4;
            // Use scanstride to skip past the rows when interlacing.  This is skipping
            // 7 rows for the first two passes, then 3 then 1.
            if (frame.interlaced === true) {
                scanstride += width * 4 * 7; // Pass 1.
            }
            var interlaceskip = 8; // Tracking the row interval in the current pass.
            for (var i = 0, il = index_stream.length; i < il; ++i) {
                var index = index_stream[i];
                if (xleft === 0) { // Beginning of new scan line
                    op += scanstride;
                    xleft = framewidth;
                    if (op >= opend) { // Catch the wrap to switch passes when interlacing.
                        scanstride = framestride * 4 + width * 4 * (interlaceskip - 1);
                        // interlaceskip / 2 * 4 is interlaceskip << 1.
                        op = opbeg + (framewidth + framestride) * (interlaceskip << 1);
                        interlaceskip >>= 1;
                    }
                }
                if (index === trans) {
                    op += 4;
                }
                else {
                    var r = buf[palette_offset + index * 3];
                    var g = buf[palette_offset + index * 3 + 1];
                    var b = buf[palette_offset + index * 3 + 2];
                    pixels[op++] = r;
                    pixels[op++] = g;
                    pixels[op++] = b;
                    pixels[op++] = 255;
                }
                --xleft;
            }
        };
    }
    function GifReaderLZWOutputIndexStream(code_stream, p, output, output_length) {
        var min_code_size = code_stream[p++];
        var clear_code = 1 << min_code_size;
        var eoi_code = clear_code + 1;
        var next_code = eoi_code + 1;
        var cur_code_size = min_code_size + 1; // Number of bits per code.
        // NOTE: This shares the same name as the encoder, but has a different
        // meaning here.  Here this masks each code coming from the code stream.
        var code_mask = (1 << cur_code_size) - 1;
        var cur_shift = 0;
        var cur = 0;
        var op = 0; // Output pointer.
        var subblock_size = code_stream[p++];
        // TODO(deanm): Would using a TypedArray be any faster?  At least it would
        // solve the fast mode / backing store uncertainty.
        // var code_table = Array(4096);
        var code_table = new Int32Array(4096); // Can be signed, we only use 20 bits.
        var prev_code = null; // Track code-1.
        while (true) {
            // Read up to two bytes, making sure we always 12-bits for max sized code.
            while (cur_shift < 16) {
                if (subblock_size === 0)
                    break; // No more data to be read.
                cur |= code_stream[p++] << cur_shift;
                cur_shift += 8;
                if (subblock_size === 1) { // Never let it get to 0 to hold logic above.
                    subblock_size = code_stream[p++]; // Next subblock.
                }
                else {
                    --subblock_size;
                }
            }
            // TODO(deanm): We should never really get here, we should have received
            // and EOI.
            if (cur_shift < cur_code_size)
                break;
            var code = cur & code_mask;
            cur >>= cur_code_size;
            cur_shift -= cur_code_size;
            // TODO(deanm): Maybe should check that the first code was a clear code,
            // at least this is what you're supposed to do.  But actually our encoder
            // now doesn't emit a clear code first anyway.
            if (code === clear_code) {
                // We don't actually have to clear the table.  This could be a good idea
                // for greater error checking, but we don't really do any anyway.  We
                // will just track it with next_code and overwrite old entries.
                next_code = eoi_code + 1;
                cur_code_size = min_code_size + 1;
                code_mask = (1 << cur_code_size) - 1;
                // Don't update prev_code ?
                prev_code = null;
                continue;
            }
            else if (code === eoi_code) {
                break;
            }
            // We have a similar situation as the decoder, where we want to store
            // variable length entries (code table entries), but we want to do in a
            // faster manner than an array of arrays.  The code below stores sort of a
            // linked list within the code table, and then "chases" through it to
            // construct the dictionary entries.  When a new entry is created, just the
            // last byte is stored, and the rest (prefix) of the entry is only
            // referenced by its table entry.  Then the code chases through the
            // prefixes until it reaches a single byte code.  We have to chase twice,
            // first to compute the length, and then to actually copy the data to the
            // output (backwards, since we know the length).  The alternative would be
            // storing something in an intermediate stack, but that doesn't make any
            // more sense.  I implemented an approach where it also stored the length
            // in the code table, although it's a bit tricky because you run out of
            // bits (12 + 12 + 8), but I didn't measure much improvements (the table
            // entries are generally not the long).  Even when I created benchmarks for
            // very long table entries the complexity did not seem worth it.
            // The code table stores the prefix entry in 12 bits and then the suffix
            // byte in 8 bits, so each entry is 20 bits.
            var chase_code = code < next_code ? code : prev_code;
            // Chase what we will output, either {CODE} or {CODE-1}.
            var chase_length = 0;
            var chase = chase_code;
            while (chase > clear_code) {
                chase = code_table[chase] >> 8;
                ++chase_length;
            }
            var k = chase;
            var op_end = op + chase_length + (chase_code !== code ? 1 : 0);
            if (op_end > output_length) {
                console.log("Warning, gif stream longer than expected.");
                return;
            }
            // Already have the first byte from the chase, might as well write it fast.
            output[op++] = k;
            op += chase_length;
            var b = op; // Track pointer, writing backwards.
            if (chase_code !== code) // The case of emitting {CODE-1} + k.
                output[op++] = k;
            chase = chase_code;
            while (chase_length--) {
                chase = code_table[chase];
                output[--b] = chase & 0xff; // Write backwards.
                chase >>= 8; // Pull down to the prefix code.
            }
            if (prev_code !== null && next_code < 4096) {
                code_table[next_code++] = prev_code << 8 | k;
                // TODO(deanm): Figure out this clearing vs code growth logic better.  I
                // have an feeling that it should just happen somewhere else, for now it
                // is awkward between when we grow past the max and then hit a clear code.
                // For now just check if we hit the max 12-bits (then a clear code should
                // follow, also of course encoded in 12-bits).
                if (next_code >= code_mask + 1 && cur_code_size < 12) {
                    ++cur_code_size;
                    code_mask = code_mask << 1 | 1;
                }
            }
            prev_code = code;
        }
        if (op !== output_length) {
            console.log("Warning, gif stream shorter than expected.");
        }
        return output;
    }

    var UPNG = {};
    if (Uint8Array && !Uint8Array.prototype.slice) {
        Uint8Array.prototype.slice = function () {
            var arg = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                arg[_i] = arguments[_i];
            }
            var _a;
            return (_a = new Uint8Array(this)).subarray.apply(_a, arg);
        };
    }
    (function (UPNG, pako$$1) {
        UPNG.toRGBA8 = function (out) {
            var w = out.width, h = out.height;
            if (out.tabs.acTL == null)
                return [UPNG.toRGBA8.decodeImage(out.data, w, h, out).buffer];
            var frms = [];
            if (out.frames[0].data == null)
                out.frames[0].data = out.data;
            var img, empty = new Uint8Array(w * h * 4);
            for (var i = 0; i < out.frames.length; i++) {
                var frm = out.frames[i];
                var fx = frm.rect.x, fy = frm.rect.y, fw = frm.rect.width, fh = frm.rect.height;
                var fdata = UPNG.toRGBA8.decodeImage(frm.data, fw, fh, out);
                if (i == 0)
                    img = fdata;
                else if (frm.blend == 0)
                    UPNG._copyTile(fdata, fw, fh, img, w, h, fx, fy, 0);
                else if (frm.blend == 1)
                    UPNG._copyTile(fdata, fw, fh, img, w, h, fx, fy, 1);
                frms.push(img.buffer);
                img = img.slice(0);
                if (frm.dispose == 0) ;
                else if (frm.dispose == 1)
                    UPNG._copyTile(empty, fw, fh, img, w, h, fx, fy, 0);
                else if (frm.dispose == 2) {
                    var pi = i - 1;
                    while (out.frames[pi].dispose == 2)
                        pi--;
                    img = new Uint8Array(frms[pi]).slice(0);
                }
            }
            return frms;
        };
        UPNG.toRGBA8.decodeImage = function (data, w, h, out) {
            var area = w * h, bpp = UPNG.decode._getBPP(out);
            var bpl = Math.ceil(w * bpp / 8); // bytes per line
            var bf = new Uint8Array(area * 4), bf32 = new Uint32Array(bf.buffer);
            var ctype = out.ctype, depth = out.depth;
            var rs = UPNG._bin.readUshort;
            //console.log(ctype, depth);
            if (ctype == 6) { // RGB + alpha
                var qarea = area << 2;
                if (depth == 8)
                    for (var i = 0; i < qarea; i++) {
                        bf[i] = data[i];
                        /*if((i&3)==3 && data[i]!=0) bf[i]=255;*/
                    }
                if (depth == 16)
                    for (var i = 0; i < qarea; i++) {
                        bf[i] = data[i << 1];
                    }
            }
            else if (ctype == 2) { // RGB
                var ts = out.tabs["tRNS"], tr = -1, tg = -1, tb = -1;
                if (ts) {
                    tr = ts[0];
                    tg = ts[1];
                    tb = ts[2];
                }
                if (depth == 8)
                    for (var i = 0; i < area; i++) {
                        var qi = i << 2, ti = i * 3;
                        bf[qi] = data[ti];
                        bf[qi + 1] = data[ti + 1];
                        bf[qi + 2] = data[ti + 2];
                        bf[qi + 3] = 255;
                        if (tr != -1 && data[ti] == tr && data[ti + 1] == tg && data[ti + 2] == tb)
                            bf[qi + 3] = 0;
                    }
                if (depth == 16)
                    for (var i = 0; i < area; i++) {
                        var qi = i << 2, ti = i * 6;
                        bf[qi] = data[ti];
                        bf[qi + 1] = data[ti + 2];
                        bf[qi + 2] = data[ti + 4];
                        bf[qi + 3] = 255;
                        if (tr != -1 && rs(data, ti) == tr && rs(data, ti + 2) == tg && rs(data, ti + 4) == tb)
                            bf[qi + 3] = 0;
                    }
            }
            else if (ctype == 3) { // palette
                var p = out.tabs["PLTE"], ap = out.tabs["tRNS"], tl = ap ? ap.length : 0;
                //console.log(p, ap);
                if (depth == 1)
                    for (var y = 0; y < h; y++) {
                        var s0 = y * bpl, t0 = y * w;
                        for (var i = 0; i < w; i++) {
                            var qi = (t0 + i) << 2, j = ((data[s0 + (i >> 3)] >> (7 - ((i & 7) << 0))) & 1), cj = 3 * j;
                            bf[qi] = p[cj];
                            bf[qi + 1] = p[cj + 1];
                            bf[qi + 2] = p[cj + 2];
                            bf[qi + 3] = (j < tl) ? ap[j] : 255;
                        }
                    }
                if (depth == 2)
                    for (var y = 0; y < h; y++) {
                        var s0 = y * bpl, t0 = y * w;
                        for (var i = 0; i < w; i++) {
                            var qi = (t0 + i) << 2, j = ((data[s0 + (i >> 2)] >> (6 - ((i & 3) << 1))) & 3), cj = 3 * j;
                            bf[qi] = p[cj];
                            bf[qi + 1] = p[cj + 1];
                            bf[qi + 2] = p[cj + 2];
                            bf[qi + 3] = (j < tl) ? ap[j] : 255;
                        }
                    }
                if (depth == 4)
                    for (var y = 0; y < h; y++) {
                        var s0 = y * bpl, t0 = y * w;
                        for (var i = 0; i < w; i++) {
                            var qi = (t0 + i) << 2, j = ((data[s0 + (i >> 1)] >> (4 - ((i & 1) << 2))) & 15), cj = 3 * j;
                            bf[qi] = p[cj];
                            bf[qi + 1] = p[cj + 1];
                            bf[qi + 2] = p[cj + 2];
                            bf[qi + 3] = (j < tl) ? ap[j] : 255;
                        }
                    }
                if (depth == 8)
                    for (var i = 0; i < area; i++) {
                        var qi = i << 2, j = data[i], cj = 3 * j;
                        bf[qi] = p[cj];
                        bf[qi + 1] = p[cj + 1];
                        bf[qi + 2] = p[cj + 2];
                        bf[qi + 3] = (j < tl) ? ap[j] : 255;
                    }
            }
            else if (ctype == 4) { // gray + alpha
                if (depth == 8)
                    for (var i = 0; i < area; i++) {
                        var qi = i << 2, di = i << 1, gr = data[di];
                        bf[qi] = gr;
                        bf[qi + 1] = gr;
                        bf[qi + 2] = gr;
                        bf[qi + 3] = data[di + 1];
                    }
                if (depth == 16)
                    for (var i = 0; i < area; i++) {
                        var qi = i << 2, di = i << 2, gr = data[di];
                        bf[qi] = gr;
                        bf[qi + 1] = gr;
                        bf[qi + 2] = gr;
                        bf[qi + 3] = data[di + 2];
                    }
            }
            else if (ctype == 0) { // gray
                var tr = out.tabs["tRNS"] ? out.tabs["tRNS"] : -1;
                if (depth == 1)
                    for (var i = 0; i < area; i++) {
                        var gr = 255 * ((data[i >> 3] >> (7 - ((i & 7)))) & 1), al = (gr == tr * 255) ? 0 : 255;
                        bf32[i] = (al << 24) | (gr << 16) | (gr << 8) | gr;
                    }
                if (depth == 2)
                    for (var i = 0; i < area; i++) {
                        var gr = 85 * ((data[i >> 2] >> (6 - ((i & 3) << 1))) & 3), al = (gr == tr * 85) ? 0 : 255;
                        bf32[i] = (al << 24) | (gr << 16) | (gr << 8) | gr;
                    }
                if (depth == 4)
                    for (var i = 0; i < area; i++) {
                        var gr = 17 * ((data[i >> 1] >> (4 - ((i & 1) << 2))) & 15), al = (gr == tr * 17) ? 0 : 255;
                        bf32[i] = (al << 24) | (gr << 16) | (gr << 8) | gr;
                    }
                if (depth == 8)
                    for (var i = 0; i < area; i++) {
                        var gr = data[i], al = (gr == tr) ? 0 : 255;
                        bf32[i] = (al << 24) | (gr << 16) | (gr << 8) | gr;
                    }
                if (depth == 16)
                    for (var i = 0; i < area; i++) {
                        var gr = data[i << 1], al = (rs(data, i << 1) == tr) ? 0 : 255;
                        bf32[i] = (al << 24) | (gr << 16) | (gr << 8) | gr;
                    }
            }
            return bf;
        };
        UPNG.decode = function (buff) {
            var data = new Uint8Array(buff), offset = 8, bin = UPNG._bin, rUs = bin.readUshort, rUi = bin.readUint;
            var out = {
                tabs: {},
                frames: []
            };
            var dd = new Uint8Array(data.length), doff = 0; // put all IDAT data into it
            var fd, foff = 0; // frames
            var mgck = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
            for (var i = 0; i < 8; i++)
                if (data[i] != mgck[i])
                    throw "The input is not a PNG file!";
            while (offset < data.length) {
                var len = bin.readUint(data, offset);
                offset += 4;
                var type = bin.readASCII(data, offset, 4);
                offset += 4;
                //console.log(type,len);
                if (type == "IHDR") {
                    UPNG.decode._IHDR(data, offset, out);
                }
                else if (type == "IDAT") {
                    for (var i = 0; i < len; i++)
                        dd[doff + i] = data[offset + i];
                    doff += len;
                }
                else if (type == "acTL") {
                    out.tabs[type] = {
                        num_frames: rUi(data, offset),
                        num_plays: rUi(data, offset + 4)
                    };
                    fd = new Uint8Array(data.length);
                }
                else if (type == "fcTL") {
                    if (foff != 0) {
                        var fr = out.frames[out.frames.length - 1];
                        fr.data = UPNG.decode._decompress(out, fd.slice(0, foff), fr.rect.width, fr.rect.height);
                        foff = 0;
                    }
                    var rct = {
                        x: rUi(data, offset + 12),
                        y: rUi(data, offset + 16),
                        width: rUi(data, offset + 4),
                        height: rUi(data, offset + 8)
                    };
                    var del = rUs(data, offset + 22);
                    del = rUs(data, offset + 20) / (del == 0 ? 100 : del);
                    var frm = {
                        rect: rct,
                        delay: Math.round(del * 1000),
                        dispose: data[offset + 24],
                        blend: data[offset + 25]
                    };
                    //console.log(frm);
                    out.frames.push(frm);
                }
                else if (type == "fdAT") {
                    for (var i = 0; i < len - 4; i++)
                        fd[foff + i] = data[offset + i + 4];
                    foff += len - 4;
                }
                else if (type == "pHYs") {
                    out.tabs[type] = [bin.readUint(data, offset), bin.readUint(data, offset + 4), data[offset + 8]];
                }
                else if (type == "cHRM") {
                    out.tabs[type] = [];
                    for (var i = 0; i < 8; i++)
                        out.tabs[type].push(bin.readUint(data, offset + i * 4));
                }
                else if (type == "tEXt") {
                    if (out.tabs[type] == null)
                        out.tabs[type] = {};
                    var nz = bin.nextZero(data, offset);
                    var keyw = bin.readASCII(data, offset, nz - offset);
                    var text = bin.readASCII(data, nz + 1, offset + len - nz - 1);
                    out.tabs[type][keyw] = text;
                }
                else if (type == "iTXt") {
                    if (out.tabs[type] == null)
                        out.tabs[type] = {};
                    var nz = 0, off = offset;
                    nz = bin.nextZero(data, off);
                    var keyw = bin.readASCII(data, off, nz - off);
                    off = nz + 1;
                    off += 2;
                    nz = bin.nextZero(data, off);
                    var ltag = bin.readASCII(data, off, nz - off);
                    off = nz + 1;
                    nz = bin.nextZero(data, off);
                    var tkeyw = bin.readUTF8(data, off, nz - off);
                    off = nz + 1;
                    var text = bin.readUTF8(data, off, len - (off - offset));
                    out.tabs[type][keyw] = text;
                }
                else if (type == "PLTE") {
                    out.tabs[type] = bin.readBytes(data, offset, len);
                }
                else if (type == "hIST") {
                    var pl = out.tabs["PLTE"].length / 3;
                    out.tabs[type] = [];
                    for (var i = 0; i < pl; i++)
                        out.tabs[type].push(rUs(data, offset + i * 2));
                }
                else if (type == "tRNS") {
                    if (out.ctype == 3)
                        out.tabs[type] = bin.readBytes(data, offset, len);
                    else if (out.ctype == 0)
                        out.tabs[type] = rUs(data, offset);
                    else if (out.ctype == 2)
                        out.tabs[type] = [rUs(data, offset), rUs(data, offset + 2), rUs(data, offset + 4)];
                    //else console.log("tRNS for unsupported color type",out.ctype, len);
                }
                else if (type == "gAMA")
                    out.tabs[type] = bin.readUint(data, offset) / 100000;
                else if (type == "sRGB")
                    out.tabs[type] = data[offset];
                else if (type == "bKGD") {
                    if (out.ctype == 0 || out.ctype == 4)
                        out.tabs[type] = [rUs(data, offset)];
                    else if (out.ctype == 2 || out.ctype == 6)
                        out.tabs[type] = [rUs(data, offset), rUs(data, offset + 2), rUs(data, offset + 4)];
                    else if (out.ctype == 3)
                        out.tabs[type] = data[offset];
                }
                else if (type == "IEND") {
                    break;
                }
                offset += len;
                var crc = bin.readUint(data, offset);
                offset += 4;
            }
            if (foff != 0) {
                var fr = out.frames[out.frames.length - 1];
                fr.data = UPNG.decode._decompress(out, fd.slice(0, foff), fr.rect.width, fr.rect.height);
                foff = 0;
            }
            out.data = UPNG.decode._decompress(out, dd, out.width, out.height);
            delete out.compress;
            delete out.interlace;
            delete out.filter;
            return out;
        };
        UPNG.decode._decompress = function (out, dd, w, h) {
            if (out.compress == 0)
                dd = UPNG.decode._inflate(dd);
            if (out.interlace == 0)
                dd = UPNG.decode._filterZero(dd, out, 0, w, h);
            else if (out.interlace == 1)
                dd = UPNG.decode._readInterlace(dd, out);
            return dd;
        };
        UPNG.decode._inflate = function (data) {
            return pako$$1["inflate"](data);
        };
        UPNG.decode._readInterlace = function (data, out) {
            var w = out.width, h = out.height;
            var bpp = UPNG.decode._getBPP(out), cbpp = bpp >> 3, bpl = Math.ceil(w * bpp / 8);
            var img = new Uint8Array(h * bpl);
            var di = 0;
            var starting_row = [0, 0, 4, 0, 2, 0, 1];
            var starting_col = [0, 4, 0, 2, 0, 1, 0];
            var row_increment = [8, 8, 8, 4, 4, 2, 2];
            var col_increment = [8, 8, 4, 4, 2, 2, 1];
            var pass = 0;
            while (pass < 7) {
                var ri = row_increment[pass], ci = col_increment[pass];
                var sw = 0, sh = 0;
                var cr = starting_row[pass];
                while (cr < h) {
                    cr += ri;
                    sh++;
                }
                var cc = starting_col[pass];
                while (cc < w) {
                    cc += ci;
                    sw++;
                }
                var bpll = Math.ceil(sw * bpp / 8);
                UPNG.decode._filterZero(data, out, di, sw, sh);
                var y = 0, row = starting_row[pass];
                while (row < h) {
                    var col = starting_col[pass];
                    var cdi = (di + y * bpll) << 3;
                    while (col < w) {
                        if (bpp == 1) {
                            var val = data[cdi >> 3];
                            val = (val >> (7 - (cdi & 7))) & 1;
                            img[row * bpl + (col >> 3)] |= (val << (7 - ((col & 3) << 0)));
                        }
                        if (bpp == 2) {
                            var val = data[cdi >> 3];
                            val = (val >> (6 - (cdi & 7))) & 3;
                            img[row * bpl + (col >> 2)] |= (val << (6 - ((col & 3) << 1)));
                        }
                        if (bpp == 4) {
                            var val = data[cdi >> 3];
                            val = (val >> (4 - (cdi & 7))) & 15;
                            img[row * bpl + (col >> 1)] |= (val << (4 - ((col & 1) << 2)));
                        }
                        if (bpp >= 8) {
                            var ii = row * bpl + col * cbpp;
                            for (var j = 0; j < cbpp; j++)
                                img[ii + j] = data[(cdi >> 3) + j];
                        }
                        cdi += bpp;
                        col += ci;
                    }
                    y++;
                    row += ri;
                }
                if (sw * sh != 0)
                    di += sh * (1 + bpll);
                pass = pass + 1;
            }
            return img;
        };
        UPNG.decode._getBPP = function (out) {
            var noc = [1, null, 3, 1, 2, null, 4][out.ctype];
            return noc * out.depth;
        };
        UPNG.decode._filterZero = function (data, out, off, w, h) {
            var bpp = UPNG.decode._getBPP(out), bpl = Math.ceil(w * bpp / 8), paeth = UPNG.decode._paeth;
            bpp = Math.ceil(bpp / 8);
            for (var y = 0; y < h; y++) {
                var i = off + y * bpl, di = i + y + 1;
                var type = data[di - 1];
                if (type == 0)
                    for (var x = 0; x < bpl; x++)
                        data[i + x] = data[di + x];
                else if (type == 1) {
                    for (var x = 0; x < bpp; x++)
                        data[i + x] = data[di + x];
                    for (var x = bpp; x < bpl; x++)
                        data[i + x] = (data[di + x] + data[i + x - bpp]) & 255;
                }
                else if (y == 0) {
                    for (var x = 0; x < bpp; x++)
                        data[i + x] = data[di + x];
                    if (type == 2)
                        for (var x = bpp; x < bpl; x++)
                            data[i + x] = (data[di + x]) & 255;
                    if (type == 3)
                        for (var x = bpp; x < bpl; x++)
                            data[i + x] = (data[di + x] + (data[i + x - bpp] >> 1)) & 255;
                    if (type == 4)
                        for (var x = bpp; x < bpl; x++)
                            data[i + x] = (data[di + x] + paeth(data[i + x - bpp], 0, 0)) & 255;
                }
                else {
                    if (type == 2) {
                        for (var x = 0; x < bpl; x++)
                            data[i + x] = (data[di + x] + data[i + x - bpl]) & 255;
                    }
                    if (type == 3) {
                        for (var x = 0; x < bpp; x++)
                            data[i + x] = (data[di + x] + (data[i + x - bpl] >> 1)) & 255;
                        for (var x = bpp; x < bpl; x++)
                            data[i + x] = (data[di + x] + ((data[i + x - bpl] + data[i + x - bpp]) >> 1)) & 255;
                    }
                    if (type == 4) {
                        for (var x = 0; x < bpp; x++)
                            data[i + x] = (data[di + x] + paeth(0, data[i + x - bpl], 0)) & 255;
                        for (var x = bpp; x < bpl; x++)
                            data[i + x] = (data[di + x] + paeth(data[i + x - bpp], data[i + x - bpl], data[i + x - bpp - bpl])) & 255;
                    }
                }
            }
            return data;
        };
        UPNG.decode._paeth = function (a, b, c) {
            var p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            if (pa <= pb && pa <= pc)
                return a;
            else if (pb <= pc)
                return b;
            return c;
        };
        UPNG.decode._IHDR = function (data, offset, out) {
            var bin = UPNG._bin;
            out.width = bin.readUint(data, offset);
            offset += 4;
            out.height = bin.readUint(data, offset);
            offset += 4;
            out.depth = data[offset];
            offset++;
            out.ctype = data[offset];
            offset++;
            out.compress = data[offset];
            offset++;
            out.filter = data[offset];
            offset++;
            out.interlace = data[offset];
            offset++;
        };
        UPNG._bin = {
            nextZero: function (data, p) {
                while (data[p] != 0)
                    p++;
                return p;
            },
            readUshort: function (buff, p) {
                return (buff[p] << 8) | buff[p + 1];
            },
            writeUshort: function (buff, p, n) {
                buff[p] = (n >> 8) & 255;
                buff[p + 1] = n & 255;
            },
            readUint: function (buff, p) {
                return (buff[p] * (256 * 256 * 256)) + ((buff[p + 1] << 16) | (buff[p + 2] << 8) | buff[p + 3]);
            },
            writeUint: function (buff, p, n) {
                buff[p] = (n >> 24) & 255;
                buff[p + 1] = (n >> 16) & 255;
                buff[p + 2] = (n >> 8) & 255;
                buff[p + 3] = n & 255;
            },
            readASCII: function (buff, p, l) {
                var s = "";
                for (var i = 0; i < l; i++)
                    s += String.fromCharCode(buff[p + i]);
                return s;
            },
            writeASCII: function (data, p, s) {
                for (var i = 0; i < s.length; i++)
                    data[p + i] = s.charCodeAt(i);
            },
            readBytes: function (buff, p, l) {
                var arr = [];
                for (var i = 0; i < l; i++)
                    arr.push(buff[p + i]);
                return arr;
            },
            pad: function (n) {
                return n.length < 2 ? "0" + n : n;
            },
            readUTF8: function (buff, p, l) {
                var s = "", ns;
                for (var i = 0; i < l; i++)
                    s += "%" + UPNG._bin.pad(buff[p + i].toString(16));
                try {
                    ns = decodeURIComponent(s);
                }
                catch (e) {
                    return UPNG._bin.readASCII(buff, p, l);
                }
                return ns;
            }
        };
        UPNG._copyTile = function (sb, sw, sh, tb, tw, th, xoff, yoff, mode) {
            var w = Math.min(sw, tw), h = Math.min(sh, th);
            var si = 0, ti = 0;
            for (var y = 0; y < h; y++)
                for (var x = 0; x < w; x++) {
                    if (xoff >= 0 && yoff >= 0) {
                        si = (y * sw + x) << 2;
                        ti = ((yoff + y) * tw + xoff + x) << 2;
                    }
                    else {
                        si = ((-yoff + y) * sw - xoff + x) << 2;
                        ti = (y * tw + x) << 2;
                    }
                    if (mode == 0) {
                        tb[ti] = sb[si];
                        tb[ti + 1] = sb[si + 1];
                        tb[ti + 2] = sb[si + 2];
                        tb[ti + 3] = sb[si + 3];
                    }
                    else if (mode == 1) {
                        var fa = sb[si + 3] * (1 / 255), fr = sb[si] * fa, fg = sb[si + 1] * fa, fb = sb[si + 2] * fa;
                        var ba = tb[ti + 3] * (1 / 255), br = tb[ti] * ba, bg = tb[ti + 1] * ba, bb = tb[ti + 2] * ba;
                        var ifa = 1 - fa, oa = fa + ba * ifa, ioa = (oa == 0 ? 0 : 1 / oa);
                        tb[ti + 3] = 255 * oa;
                        tb[ti + 0] = (fr + br * ifa) * ioa;
                        tb[ti + 1] = (fg + bg * ifa) * ioa;
                        tb[ti + 2] = (fb + bb * ifa) * ioa;
                    }
                    else if (mode == 2) { // copy only differences, otherwise zero
                        var fa = sb[si + 3], fr = sb[si], fg = sb[si + 1], fb = sb[si + 2];
                        var ba = tb[ti + 3], br = tb[ti], bg = tb[ti + 1], bb = tb[ti + 2];
                        if (fa == ba && fr == br && fg == bg && fb == bb) {
                            tb[ti] = 0;
                            tb[ti + 1] = 0;
                            tb[ti + 2] = 0;
                            tb[ti + 3] = 0;
                        }
                        else {
                            tb[ti] = fr;
                            tb[ti + 1] = fg;
                            tb[ti + 2] = fb;
                            tb[ti + 3] = fa;
                        }
                    }
                    else if (mode == 3) { // check if can be blended
                        var fa = sb[si + 3], fr = sb[si], fg = sb[si + 1], fb = sb[si + 2];
                        var ba = tb[ti + 3], br = tb[ti], bg = tb[ti + 1], bb = tb[ti + 2];
                        if (fa == ba && fr == br && fg == bg && fb == bb)
                            continue;
                        //if(fa!=255 && ba!=0) return false;
                        if (fa < 220 && ba > 20)
                            return false;
                    }
                }
            return true;
        };
        UPNG.encode = function (bufs, w, h, ps, dels, forbidPlte) {
            if (ps == null)
                ps = 0;
            if (forbidPlte == null)
                forbidPlte = false;
            var nimg = UPNG.encode.compress(bufs, w, h, ps, false, forbidPlte);
            UPNG.encode.compressPNG(nimg, -1);
            return UPNG.encode._main(nimg, w, h, dels);
        };
        UPNG.encodeLL = function (bufs, w, h, cc, ac, depth, dels) {
            var nimg = {
                ctype: 0 + (cc == 1 ? 0 : 2) + (ac == 0 ? 0 : 4),
                depth: depth,
                frames: []
            };
            var bipp = (cc + ac) * depth, bipl = bipp * w;
            for (var i = 0; i < bufs.length; i++)
                nimg.frames.push({
                    rect: {
                        x: 0,
                        y: 0,
                        width: w,
                        height: h
                    },
                    img: new Uint8Array(bufs[i]),
                    blend: 0,
                    dispose: 1,
                    bpp: Math.ceil(bipp / 8),
                    bpl: Math.ceil(bipl / 8)
                });
            UPNG.encode.compressPNG(nimg, 4);
            return UPNG.encode._main(nimg, w, h, dels);
        };
        UPNG.encode._main = function (nimg, w, h, dels) {
            var crc = UPNG.crc.crc, wUi = UPNG._bin.writeUint, wUs = UPNG._bin.writeUshort, wAs = UPNG._bin.writeASCII;
            var offset = 8, anim = nimg.frames.length > 1, pltAlpha = false;
            var leng = 8 + (16 + 5 + 4) + (9 + 4) + (anim ? 20 : 0);
            if (nimg.ctype == 3) {
                var dl = nimg.plte.length;
                for (var i = 0; i < dl; i++)
                    if ((nimg.plte[i] >>> 24) != 255)
                        pltAlpha = true;
                leng += (8 + dl * 3 + 4) + (pltAlpha ? (8 + dl * 1 + 4) : 0);
            }
            for (var j = 0; j < nimg.frames.length; j++) {
                var fr = nimg.frames[j];
                if (anim)
                    leng += 38;
                leng += fr.cimg.length + 12;
                if (j != 0)
                    leng += 4;
            }
            leng += 12;
            var data = new Uint8Array(leng);
            var wr = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
            for (var i = 0; i < 8; i++)
                data[i] = wr[i];
            wUi(data, offset, 13);
            offset += 4;
            wAs(data, offset, "IHDR");
            offset += 4;
            wUi(data, offset, w);
            offset += 4;
            wUi(data, offset, h);
            offset += 4;
            data[offset] = nimg.depth;
            offset++; // depth
            data[offset] = nimg.ctype;
            offset++; // ctype
            data[offset] = 0;
            offset++; // compress
            data[offset] = 0;
            offset++; // filter
            data[offset] = 0;
            offset++; // interlace
            wUi(data, offset, crc(data, offset - 17, 17));
            offset += 4; // crc
            // 9 bytes to say, that it is sRGB
            wUi(data, offset, 1);
            offset += 4;
            wAs(data, offset, "sRGB");
            offset += 4;
            data[offset] = 1;
            offset++;
            wUi(data, offset, crc(data, offset - 5, 5));
            offset += 4; // crc
            if (anim) {
                wUi(data, offset, 8);
                offset += 4;
                wAs(data, offset, "acTL");
                offset += 4;
                wUi(data, offset, nimg.frames.length);
                offset += 4;
                wUi(data, offset, 0);
                offset += 4;
                wUi(data, offset, crc(data, offset - 12, 12));
                offset += 4; // crc
            }
            if (nimg.ctype == 3) {
                var dl = nimg.plte.length;
                wUi(data, offset, dl * 3);
                offset += 4;
                wAs(data, offset, "PLTE");
                offset += 4;
                for (var i = 0; i < dl; i++) {
                    var ti = i * 3, c = nimg.plte[i], r = (c) & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255;
                    data[offset + ti + 0] = r;
                    data[offset + ti + 1] = g;
                    data[offset + ti + 2] = b;
                }
                offset += dl * 3;
                wUi(data, offset, crc(data, offset - dl * 3 - 4, dl * 3 + 4));
                offset += 4; // crc
                if (pltAlpha) {
                    wUi(data, offset, dl);
                    offset += 4;
                    wAs(data, offset, "tRNS");
                    offset += 4;
                    for (var i = 0; i < dl; i++)
                        data[offset + i] = (nimg.plte[i] >>> 24) & 255;
                    offset += dl;
                    wUi(data, offset, crc(data, offset - dl - 4, dl + 4));
                    offset += 4; // crc
                }
            }
            var fi = 0;
            for (var j = 0; j < nimg.frames.length; j++) {
                var fr = nimg.frames[j];
                if (anim) {
                    wUi(data, offset, 26);
                    offset += 4;
                    wAs(data, offset, "fcTL");
                    offset += 4;
                    wUi(data, offset, fi++);
                    offset += 4;
                    wUi(data, offset, fr.rect.width);
                    offset += 4;
                    wUi(data, offset, fr.rect.height);
                    offset += 4;
                    wUi(data, offset, fr.rect.x);
                    offset += 4;
                    wUi(data, offset, fr.rect.y);
                    offset += 4;
                    wUs(data, offset, dels[j]);
                    offset += 2;
                    wUs(data, offset, 1000);
                    offset += 2;
                    data[offset] = fr.dispose;
                    offset++; // dispose
                    data[offset] = fr.blend;
                    offset++; // blend
                    wUi(data, offset, crc(data, offset - 30, 30));
                    offset += 4; // crc
                }
                var imgd = fr.cimg, dl = imgd.length;
                wUi(data, offset, dl + (j == 0 ? 0 : 4));
                offset += 4;
                var ioff = offset;
                wAs(data, offset, (j == 0) ? "IDAT" : "fdAT");
                offset += 4;
                if (j != 0) {
                    wUi(data, offset, fi++);
                    offset += 4;
                }
                for (var i = 0; i < dl; i++)
                    data[offset + i] = imgd[i];
                offset += dl;
                wUi(data, offset, crc(data, ioff, offset - ioff));
                offset += 4; // crc
            }
            wUi(data, offset, 0);
            offset += 4;
            wAs(data, offset, "IEND");
            offset += 4;
            wUi(data, offset, crc(data, offset - 4, 4));
            offset += 4; // crc
            return data.buffer;
        };
        UPNG.encode.compressPNG = function (out, filter) {
            for (var i = 0; i < out.frames.length; i++) {
                var frm = out.frames[i], nw = frm.rect.width, nh = frm.rect.height;
                var fdata = new Uint8Array(nh * frm.bpl + nh);
                frm.cimg = UPNG.encode._filterZero(frm.img, nh, frm.bpp, frm.bpl, fdata, filter);
            }
        };
        UPNG.encode.compress = function (bufs, w, h, ps, forGIF, forbidPlte) {
            //var time = Date.now();
            if (forbidPlte == null)
                forbidPlte = false;
            var ctype = 6, depth = 8, alphaAnd = 255;
            for (var j = 0; j < bufs.length; j++) { // when not quantized, other frames can contain colors, that are not in an initial frame
                var img = new Uint8Array(bufs[j]), ilen = img.length;
                for (var i = 0; i < ilen; i += 4)
                    alphaAnd &= img[i + 3];
            }
            var gotAlpha = (alphaAnd != 255);
            //console.log("alpha check", Date.now()-time);  time = Date.now();
            var brute = gotAlpha && forGIF; // brute : frames can only be copied, not "blended"
            var frms = UPNG.encode.framize(bufs, w, h, forGIF, brute);
            //console.log("framize", Date.now()-time);  time = Date.now();
            var cmap = {}, plte = [], inds = [];
            if (ps != 0) {
                var nbufs = [];
                for (var i = 0; i < frms.length; i++)
                    nbufs.push(frms[i].img.buffer);
                var abuf = UPNG.encode.concatRGBA(nbufs, forGIF), qres = UPNG.quantize(abuf, ps);
                var cof = 0, bb = new Uint8Array(qres.abuf);
                for (var i = 0; i < frms.length; i++) {
                    var ti = frms[i].img, bln = ti.length;
                    inds.push(new Uint8Array(qres.inds.buffer, cof >> 2, bln >> 2));
                    for (var j = 0; j < bln; j += 4) {
                        ti[j] = bb[cof + j];
                        ti[j + 1] = bb[cof + j + 1];
                        ti[j + 2] = bb[cof + j + 2];
                        ti[j + 3] = bb[cof + j + 3];
                    }
                    cof += bln;
                }
                for (var i = 0; i < qres.plte.length; i++)
                    plte.push(qres.plte[i].est.rgba);
                //console.log("quantize", Date.now()-time);  time = Date.now();
            }
            else {
                // what if ps==0, but there are <=256 colors?  we still need to detect, if the palette could be used
                for (var j = 0; j < frms.length; j++) { // when not quantized, other frames can contain colors, that are not in an initial frame
                    var frm = frms[j], img32 = new Uint32Array(frm.img.buffer), nw = frm.rect.width, ilen = img32.length;
                    var ind = new Uint8Array(ilen);
                    inds.push(ind);
                    for (var i = 0; i < ilen; i++) {
                        var c = img32[i];
                        if (i != 0 && c == img32[i - 1])
                            ind[i] = ind[i - 1];
                        else if (i > nw && c == img32[i - nw])
                            ind[i] = ind[i - nw];
                        else {
                            var cmc = cmap[c];
                            if (cmc == null) {
                                cmap[c] = cmc = plte.length;
                                plte.push(c);
                                if (plte.length >= 300)
                                    break;
                            }
                            ind[i] = cmc;
                        }
                    }
                }
                //console.log("make palette", Date.now()-time);  time = Date.now();
            }
            var cc = plte.length; //console.log("colors:",cc);
            if (cc <= 256 && forbidPlte == false) {
                if (cc <= 2)
                    depth = 1;
                else if (cc <= 4)
                    depth = 2;
                else if (cc <= 16)
                    depth = 4;
                else
                    depth = 8;
                if (forGIF)
                    depth = 8;
            }
            for (var j = 0; j < frms.length; j++) {
                var frm = frms[j], nx = frm.rect.x, ny = frm.rect.y, nw = frm.rect.width, nh = frm.rect.height;
                var cimg = frm.img, cimg32 = new Uint32Array(cimg.buffer);
                var bpl = 4 * nw, bpp = 4;
                if (cc <= 256 && forbidPlte == false) {
                    bpl = Math.ceil(depth * nw / 8);
                    var nimg = new Uint8Array(bpl * nh);
                    var inj = inds[j];
                    for (var y = 0; y < nh; y++) {
                        var i = y * bpl, ii = y * nw;
                        if (depth == 8)
                            for (var x = 0; x < nw; x++)
                                nimg[i + (x)] = (inj[ii + x]);
                        else if (depth == 4)
                            for (var x = 0; x < nw; x++)
                                nimg[i + (x >> 1)] |= (inj[ii + x] << (4 - (x & 1) * 4));
                        else if (depth == 2)
                            for (var x = 0; x < nw; x++)
                                nimg[i + (x >> 2)] |= (inj[ii + x] << (6 - (x & 3) * 2));
                        else if (depth == 1)
                            for (var x = 0; x < nw; x++)
                                nimg[i + (x >> 3)] |= (inj[ii + x] << (7 - (x & 7) * 1));
                    }
                    cimg = nimg;
                    ctype = 3;
                    bpp = 1;
                }
                else if (gotAlpha == false && frms.length == 1) { // some next "reduced" frames may contain alpha for blending
                    var nimg = new Uint8Array(nw * nh * 3), area = nw * nh;
                    for (var i = 0; i < area; i++) {
                        var ti = i * 3, qi = i * 4;
                        nimg[ti] = cimg[qi];
                        nimg[ti + 1] = cimg[qi + 1];
                        nimg[ti + 2] = cimg[qi + 2];
                    }
                    cimg = nimg;
                    ctype = 2;
                    bpp = 3;
                    bpl = 3 * nw;
                }
                frm.img = cimg;
                frm.bpl = bpl;
                frm.bpp = bpp;
            }
            //console.log("colors => palette indices", Date.now()-time);  time = Date.now();
            return {
                ctype: ctype,
                depth: depth,
                plte: plte,
                frames: frms
            };
        };
        UPNG.encode.framize = function (bufs, w, h, forGIF, brute) {
            var frms = [];
            for (var j = 0; j < bufs.length; j++) {
                var cimg = new Uint8Array(bufs[j]), cimg32 = new Uint32Array(cimg.buffer);
                var nx = 0, ny = 0, nw = w, nh = h, blend = 0;
                if (j != 0 && !brute) {
                    var tlim = (forGIF || j == 1 || frms[frms.length - 2].dispose == 2) ? 1 : 2, tstp = 0, tarea = 1e9;
                    for (var it = 0; it < tlim; it++) {
                        var pimg = new Uint8Array(bufs[j - 1 - it]), p32 = new Uint32Array(bufs[j - 1 - it]);
                        var mix = w, miy = h, max = -1, may = -1;
                        for (var y = 0; y < h; y++)
                            for (var x = 0; x < w; x++) {
                                var i = y * w + x;
                                if (cimg32[i] != p32[i]) {
                                    if (x < mix)
                                        mix = x;
                                    if (x > max)
                                        max = x;
                                    if (y < miy)
                                        miy = y;
                                    if (y > may)
                                        may = y;
                                }
                            }
                        var sarea = (max == -1) ? 1 : (max - mix + 1) * (may - miy + 1);
                        if (sarea < tarea) {
                            tarea = sarea;
                            tstp = it;
                            if (max == -1) {
                                nx = ny = 0;
                                nw = nh = 1;
                            }
                            else {
                                nx = mix;
                                ny = miy;
                                nw = max - mix + 1;
                                nh = may - miy + 1;
                            }
                        }
                    }
                    var pimg = new Uint8Array(bufs[j - 1 - tstp]);
                    if (tstp == 1)
                        frms[frms.length - 1].dispose = 2;
                    var nimg = new Uint8Array(nw * nh * 4);
                    UPNG._copyTile(pimg, w, h, nimg, nw, nh, -nx, -ny, 0);
                    if (UPNG._copyTile(cimg, w, h, nimg, nw, nh, -nx, -ny, 3)) {
                        UPNG._copyTile(cimg, w, h, nimg, nw, nh, -nx, -ny, 2);
                        blend = 1;
                    }
                    else {
                        UPNG._copyTile(cimg, w, h, nimg, nw, nh, -nx, -ny, 0);
                        blend = 0;
                    }
                    cimg = nimg;
                }
                else
                    cimg = cimg.slice(0); // img may be rewrited further ... don't rewrite input
                frms.push({
                    rect: {
                        x: nx,
                        y: ny,
                        width: nw,
                        height: nh
                    },
                    img: cimg,
                    blend: blend,
                    dispose: brute ? 1 : 0
                });
            }
            return frms;
        };
        UPNG.encode._filterZero = function (img, h, bpp, bpl, data, filter) {
            if (filter != -1) {
                for (var y = 0; y < h; y++)
                    UPNG.encode._filterLine(data, img, y, bpl, bpp, filter);
                return pako$$1["deflate"](data);
            }
            var fls = [];
            for (var t = 0; t < 5; t++) {
                if (h * bpl > 500000 && (t == 2 || t == 3 || t == 4))
                    continue;
                for (var y = 0; y < h; y++)
                    UPNG.encode._filterLine(data, img, y, bpl, bpp, t);
                fls.push(pako$$1["deflate"](data));
                if (bpp == 1)
                    break;
            }
            var ti, tsize = 1e9;
            for (var i = 0; i < fls.length; i++)
                if (fls[i].length < tsize) {
                    ti = i;
                    tsize = fls[i].length;
                }
            return fls[ti];
        };
        UPNG.encode._filterLine = function (data, img, y, bpl, bpp, type) {
            var i = y * bpl, di = i + y, paeth = UPNG.decode._paeth;
            data[di] = type;
            di++;
            if (type == 0)
                for (var x = 0; x < bpl; x++)
                    data[di + x] = img[i + x];
            else if (type == 1) {
                for (var x = 0; x < bpp; x++)
                    data[di + x] = img[i + x];
                for (var x = bpp; x < bpl; x++)
                    data[di + x] = (img[i + x] - img[i + x - bpp] + 256) & 255;
            }
            else if (y == 0) {
                for (var x = 0; x < bpp; x++)
                    data[di + x] = img[i + x];
                if (type == 2)
                    for (var x = bpp; x < bpl; x++)
                        data[di + x] = img[i + x];
                if (type == 3)
                    for (var x = bpp; x < bpl; x++)
                        data[di + x] = (img[i + x] - (img[i + x - bpp] >> 1) + 256) & 255;
                if (type == 4)
                    for (var x = bpp; x < bpl; x++)
                        data[di + x] = (img[i + x] - paeth(img[i + x - bpp], 0, 0) + 256) & 255;
            }
            else {
                if (type == 2) {
                    for (var x = 0; x < bpl; x++)
                        data[di + x] = (img[i + x] + 256 - img[i + x - bpl]) & 255;
                }
                if (type == 3) {
                    for (var x = 0; x < bpp; x++)
                        data[di + x] = (img[i + x] + 256 - (img[i + x - bpl] >> 1)) & 255;
                    for (var x = bpp; x < bpl; x++)
                        data[di + x] = (img[i + x] + 256 - ((img[i + x - bpl] + img[i + x - bpp]) >> 1)) & 255;
                }
                if (type == 4) {
                    for (var x = 0; x < bpp; x++)
                        data[di + x] = (img[i + x] + 256 - paeth(0, img[i + x - bpl], 0)) & 255;
                    for (var x = bpp; x < bpl; x++)
                        data[di + x] = (img[i + x] + 256 - paeth(img[i + x - bpp], img[i + x - bpl], img[i + x - bpp - bpl])) & 255;
                }
            }
        };
        UPNG.crc = {
            table: (function () {
                var tab = new Uint32Array(256);
                for (var n = 0; n < 256; n++) {
                    var c = n;
                    for (var k = 0; k < 8; k++) {
                        if (c & 1)
                            c = 0xedb88320 ^ (c >>> 1);
                        else
                            c = c >>> 1;
                    }
                    tab[n] = c;
                }
                return tab;
            })(),
            update: function (c, buf, off, len) {
                for (var i = 0; i < len; i++)
                    c = UPNG.crc.table[(c ^ buf[off + i]) & 0xff] ^ (c >>> 8);
                return c;
            },
            crc: function (b, o, l) {
                return UPNG.crc.update(0xffffffff, b, o, l) ^ 0xffffffff;
            }
        };
        UPNG.quantize = function (abuf, ps) {
            var oimg = new Uint8Array(abuf), nimg = oimg.slice(0), nimg32 = new Uint32Array(nimg.buffer);
            var KD = UPNG.quantize.getKDtree(nimg, ps);
            var root = KD[0], leafs = KD[1];
            var planeDst = UPNG.quantize.planeDst;
            var sb = oimg, tb = nimg32, len = sb.length;
            var inds = new Uint8Array(oimg.length >> 2);
            for (var i = 0; i < len; i += 4) {
                var r = sb[i] * (1 / 255), g = sb[i + 1] * (1 / 255), b = sb[i + 2] * (1 / 255), a = sb[i + 3] * (1 / 255);
                //  exact, but too slow :(
                var nd = UPNG.quantize.getNearest(root, r, g, b, a);
                //var nd = root;
                //while(nd.left) nd = (planeDst(nd.est,r,g,b,a)<=0) ? nd.left : nd.right;
                inds[i >> 2] = nd.ind;
                tb[i >> 2] = nd.est.rgba;
            }
            return {
                abuf: nimg.buffer,
                inds: inds,
                plte: leafs
            };
        };
        UPNG.quantize.getKDtree = function (nimg, ps, err) {
            if (err == null)
                err = 0.0001;
            var nimg32 = new Uint32Array(nimg.buffer);
            var root = {
                i0: 0,
                i1: nimg.length,
                bst: null,
                est: null,
                tdst: 0,
                left: null,
                right: null
            }; // basic statistic, extra statistic
            root.bst = UPNG.quantize.stats(nimg, root.i0, root.i1);
            root.est = UPNG.quantize.estats(root.bst);
            var leafs = [root];
            while (leafs.length < ps) {
                var maxL = 0, mi = 0;
                for (var i = 0; i < leafs.length; i++)
                    if (leafs[i].est.L > maxL) {
                        maxL = leafs[i].est.L;
                        mi = i;
                    }
                if (maxL < err)
                    break;
                var node = leafs[mi];
                var s0 = UPNG.quantize.splitPixels(nimg, nimg32, node.i0, node.i1, node.est.e, node.est.eMq255);
                var s0wrong = (node.i0 >= s0 || node.i1 <= s0);
                //console.log(maxL, leafs.length, mi);
                if (s0wrong) {
                    node.est.L = 0;
                    continue;
                }
                var ln = {
                    i0: node.i0,
                    i1: s0,
                    bst: null,
                    est: null,
                    tdst: 0,
                    left: null,
                    right: null
                };
                ln.bst = UPNG.quantize.stats(nimg, ln.i0, ln.i1);
                ln.est = UPNG.quantize.estats(ln.bst);
                var rn = {
                    i0: s0,
                    i1: node.i1,
                    bst: null,
                    est: null,
                    tdst: 0,
                    left: null,
                    right: null
                };
                rn.bst = {
                    R: [],
                    m: [],
                    N: node.bst.N - ln.bst.N
                };
                for (var i = 0; i < 16; i++)
                    rn.bst.R[i] = node.bst.R[i] - ln.bst.R[i];
                for (var i = 0; i < 4; i++)
                    rn.bst.m[i] = node.bst.m[i] - ln.bst.m[i];
                rn.est = UPNG.quantize.estats(rn.bst);
                node.left = ln;
                node.right = rn;
                leafs[mi] = ln;
                leafs.push(rn);
            }
            leafs.sort(function (a, b) {
                return b.bst.N - a.bst.N;
            });
            for (var i = 0; i < leafs.length; i++)
                leafs[i].ind = i;
            return [root, leafs];
        };
        UPNG.quantize.getNearest = function (nd, r, g, b, a) {
            if (nd.left == null) {
                nd.tdst = UPNG.quantize.dist(nd.est.q, r, g, b, a);
                return nd;
            }
            var planeDst = UPNG.quantize.planeDst(nd.est, r, g, b, a);
            var node0 = nd.left, node1 = nd.right;
            if (planeDst > 0) {
                node0 = nd.right;
                node1 = nd.left;
            }
            var ln = UPNG.quantize.getNearest(node0, r, g, b, a);
            if (ln.tdst <= planeDst * planeDst)
                return ln;
            var rn = UPNG.quantize.getNearest(node1, r, g, b, a);
            return rn.tdst < ln.tdst ? rn : ln;
        };
        UPNG.quantize.planeDst = function (est, r, g, b, a) {
            var e = est.e;
            return e[0] * r + e[1] * g + e[2] * b + e[3] * a - est.eMq;
        };
        UPNG.quantize.dist = function (q, r, g, b, a) {
            var d0 = r - q[0], d1 = g - q[1], d2 = b - q[2], d3 = a - q[3];
            return d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3;
        };
        UPNG.quantize.splitPixels = function (nimg, nimg32, i0, i1, e, eMq) {
            var vecDot = UPNG.quantize.vecDot;
            i1 -= 4;
            while (i0 < i1) {
                while (vecDot(nimg, i0, e) <= eMq)
                    i0 += 4;
                while (vecDot(nimg, i1, e) > eMq)
                    i1 -= 4;
                if (i0 >= i1)
                    break;
                var t = nimg32[i0 >> 2];
                nimg32[i0 >> 2] = nimg32[i1 >> 2];
                nimg32[i1 >> 2] = t;
                i0 += 4;
                i1 -= 4;
            }
            while (vecDot(nimg, i0, e) > eMq)
                i0 -= 4;
            return i0 + 4;
        };
        UPNG.quantize.vecDot = function (nimg, i, e) {
            return nimg[i] * e[0] + nimg[i + 1] * e[1] + nimg[i + 2] * e[2] + nimg[i + 3] * e[3];
        };
        UPNG.quantize.stats = function (nimg, i0, i1) {
            var R = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            var m = [0, 0, 0, 0];
            var N = (i1 - i0) >> 2;
            for (var i = i0; i < i1; i += 4) {
                var r = nimg[i] * (1 / 255), g = nimg[i + 1] * (1 / 255), b = nimg[i + 2] * (1 / 255), a = nimg[i + 3] * (1 / 255);
                //var r = nimg[i], g = nimg[i+1], b = nimg[i+2], a = nimg[i+3];
                m[0] += r;
                m[1] += g;
                m[2] += b;
                m[3] += a;
                R[0] += r * r;
                R[1] += r * g;
                R[2] += r * b;
                R[3] += r * a;
                R[5] += g * g;
                R[6] += g * b;
                R[7] += g * a;
                R[10] += b * b;
                R[11] += b * a;
                R[15] += a * a;
            }
            R[4] = R[1];
            R[8] = R[2];
            R[9] = R[6];
            R[12] = R[3];
            R[13] = R[7];
            R[14] = R[11];
            return {
                R: R,
                m: m,
                N: N
            };
        };
        UPNG.quantize.estats = function (stats) {
            var R = stats.R, m = stats.m, N = stats.N;
            // when all samples are equal, but N is large (millions), the Rj can be non-zero ( 0.0003.... - precission error)
            var m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3], iN = (N == 0 ? 0 : 1 / N);
            var Rj = [R[0] - m0 * m0 * iN, R[1] - m0 * m1 * iN, R[2] - m0 * m2 * iN, R[3] - m0 * m3 * iN, R[4] - m1 * m0 * iN, R[5] - m1 * m1 * iN, R[6] - m1 * m2 * iN, R[7] - m1 * m3 * iN, R[8] - m2 * m0 * iN, R[9] - m2 * m1 * iN, R[10] - m2 * m2 * iN, R[11] - m2 * m3 * iN, R[12] - m3 * m0 * iN, R[13] - m3 * m1 * iN, R[14] - m3 * m2 * iN, R[15] - m3 * m3 * iN];
            var A = Rj, M = UPNG.M4;
            var b = [0.5, 0.5, 0.5, 0.5], mi = 0, tmi = 0;
            if (N != 0)
                for (var i = 0; i < 10; i++) {
                    b = M.multVec(A, b);
                    tmi = Math.sqrt(M.dot(b, b));
                    b = M.sml(1 / tmi, b);
                    if (Math.abs(tmi - mi) < 1e-9)
                        break;
                    mi = tmi;
                }
            //b = [0,0,1,0];  mi=N;
            var q = [m0 * iN, m1 * iN, m2 * iN, m3 * iN];
            var eMq255 = M.dot(M.sml(255, q), b);
            return {
                Cov: Rj,
                q: q,
                e: b,
                L: mi,
                eMq255: eMq255,
                eMq: M.dot(b, q),
                rgba: (((Math.round(255 * q[3]) << 24) | (Math.round(255 * q[2]) << 16) | (Math.round(255 * q[1]) << 8) | (Math.round(255 * q[0]) << 0)) >>> 0)
            };
        };
        UPNG.M4 = {
            multVec: function (m, v) {
                return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3] * v[3], m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7] * v[3], m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11] * v[3], m[12] * v[0] + m[13] * v[1] + m[14] * v[2] + m[15] * v[3]];
            },
            dot: function (x, y) {
                return x[0] * y[0] + x[1] * y[1] + x[2] * y[2] + x[3] * y[3];
            },
            sml: function (a, y) {
                return [a * y[0], a * y[1], a * y[2], a * y[3]];
            }
        };
        UPNG.encode.concatRGBA = function (bufs, roundAlpha) {
            var tlen = 0;
            for (var i = 0; i < bufs.length; i++)
                tlen += bufs[i].byteLength;
            var nimg = new Uint8Array(tlen), noff = 0;
            for (var i = 0; i < bufs.length; i++) {
                var img = new Uint8Array(bufs[i]), il = img.length;
                for (var j = 0; j < il; j += 4) {
                    var r = img[j], g = img[j + 1], b = img[j + 2], a = img[j + 3];
                    if (roundAlpha)
                        a = (a & 128) == 0 ? 0 : 255;
                    if (a == 0)
                        r = g = b = 0;
                    nimg[noff + j] = r;
                    nimg[noff + j + 1] = g;
                    nimg[noff + j + 2] = b;
                    nimg[noff + j + 3] = a;
                }
                noff += il;
            }
            return nimg.buffer;
        };
    })(UPNG, pako);

    var Image = /** @class */ (function () {
        function Image(esource, resources) {
            var _ts = this;
            _ts.esource = esource;
            _ts.resources = resources;
            _ts.init();
        }
        Image.prototype.init = function () {
            var _ts = this, esource = _ts.esource, resources = _ts.resources;
            _ts.temp = {
                //loop:0,                                       // 保存当前需要播放的次数
                //tickerIsAdd:undefined                         // 保存轮循执行器是否添加
                events: {} // 用于存放事件
            };
            // 属性
            _ts.__attr = {
                autoPlay: true,
                loop: 0 // 默认无限次播放
            };
            // 方法
            _ts.__method = {
                play: _ts.play // 播放方法
            };
            // 状态
            _ts.__status = {
                status: 'init',
                frame: 0,
                loops: 0,
                time: 0
            };
            // 循环执行器
            _ts.ticker = new PIXI.Ticker();
            _ts.ticker.stop();
            // 精灵
            _ts.sprite = this.createSprite(esource, resources);
        };
        // 播放
        Image.prototype.play = function (loop, callback) {
            var _ts = this;
            // 没有纹理材质时抛出错误
            if (!_ts.textures.length) {
                throw new Error('没有可用的textures');
            }
            // 纹理材质只有一帧时不往下执行
            if (_ts.textures.length === 1) {
                return;
            }
            var status = _ts.__status, attr = _ts.__attr, time = 0;
            // 当状态是停止的时候，将播放次数清0
            if (status.status === 'stop') {
                status.loops = 0;
            }
            // 设置循环参数
            loop = typeof loop === 'number' ? loop : attr.loop;
            _ts.temp.loop = loop;
            attr.loop = loop;
            // 为轮循执行器添加一个操作
            if (!_ts.temp.tickerIsAdd) {
                _ts.ticker.add(function (deltaTime) {
                    var elapsed = PIXI.Ticker.shared.elapsedMS;
                    time += elapsed;
                    // 当帧停留时间已达到间隔帧率时播放下一帧
                    if (time > _ts.framesDelay[status.frame]) {
                        status.frame++;
                        // 修改状态为执行中
                        status.status = 'playing';
                        // 当一次播放完成，将播放帧归0，并记录播放次数
                        if (status.frame > _ts.textures.length - 1) {
                            status.frame = 0;
                            status.loops++;
                            // 当指定了有效的播放次数并且当前播放次数达到指定次数时，执行回调则停止播放
                            if (_ts.temp.loop > 0 && status.loops >= _ts.temp.loop) {
                                if (typeof callback === 'function') {
                                    callback(status);
                                }
                                // 修改状态为执行完成并停止
                                status.status = 'played';
                                _ts.runEvent('played', status);
                                _ts.stop();
                            }
                        }
                        // 修改精灵纹理材质与当前的帧率相匹配
                        _ts.sprite.texture = _ts.textures[status.frame];
                        time = 0;
                        _ts.runEvent('playing', status);
                    }
                });
                _ts.temp.tickerIsAdd = true;
            }
            // 让轮循执行器开始执行
            _ts.ticker.start();
        };
        // 暂停
        Image.prototype.pause = function () {
            var _ts = this, status = _ts.__status;
            _ts.ticker.stop();
            status.status = 'pause';
            _ts.runEvent('pause', status);
        };
        // 停止播放并跳至第一帧
        Image.prototype.stop = function () {
            var _ts = this, status = _ts.__status;
            _ts.ticker.stop();
            status.status = 'stop';
            _ts.runEvent('stop', status);
        };
        // 跳至指定的帧数
        Image.prototype.jumpToFrame = function (frameIndex) {
            var _ts = this, textures = _ts.textures;
            // 没有纹理材质时抛出错误
            if (!textures.length) {
                throw new Error('没有可用的textures');
            }
            var status = _ts.__status;
            frameIndex = frameIndex < 0 ? 0 : frameIndex > textures.length - 1 ? textures.length - 1 : frameIndex;
            if (typeof frameIndex === 'number') {
                _ts.sprite.texture = textures[frameIndex];
                status.frame = frameIndex;
            }
        };
        // 获取总播放时长
        Image.prototype.getDuration = function () {
            var _ts = this, framesDelay = _ts.framesDelay;
            // 没有帧时间时抛出错误
            if (!framesDelay.length) {
                throw new Error('未找到图片帧时间');
            }
            var time = 0;
            for (var i = 0, len = framesDelay.length; i < len; i++) {
                time += framesDelay[i];
            }
            return time;
        };
        // 获取总帧数
        Image.prototype.getFramesLength = function () {
            var _ts = this;
            // 没有纹理材质时抛出错误
            if (!_ts.textures.length) {
                throw new Error('没有可用的textures');
            }
            return _ts.textures.length;
        };
        // 事件
        Image.prototype.on = function (type, fun) {
            var _ts = this;
            switch (type) {
                case 'playing':
                case 'played':
                case 'pause':
                case 'stop':
                    _ts.temp.events[type] = fun;
                    break;
                default:
                    throw new Error('无效的事件');
                    break;
            }
        };
        Image.prototype.runEvent = function (type, status) {
            var temp = this.temp;
            if (typeof temp.events[type] === 'function') {
                temp.events[type](status);
            }
        };
        /**
         * 创建精灵
         * @param  {array:string}} imgSrc 图片资源路径
         * @param  {object} resources 已经加载的缓存资源
         * @return {object} 返回精灵
         */
        Image.prototype.createSprite = function (esource, resources) {
            var _ts = this;
            var Sprite = PIXI.Sprite, imgSrc = esource, exeName = $getExeName(imgSrc.toLocaleLowerCase());
            // 文件扩展名为gif或png则返回对应的名称，其它反返回other
            exeName = exeName === 'gif' || exeName === 'png' ? exeName : 'other';
            var funs = {
                'gif': function () {
                    var gifDecodeData = _ts.gifResourceToTextures(resources[imgSrc]);
                    _ts.textures = gifDecodeData.textures;
                    _ts.framesDelay = gifDecodeData.delayTimes;
                    _ts.play();
                    // 返回精灵并将纹理材质设置为第一帧图像
                    return new Sprite(_ts.textures[0]);
                },
                'png': function () {
                    var pngDecodeData = _ts.apngResourceToTextures(resources[imgSrc]);
                    _ts.textures = pngDecodeData.textures;
                    _ts.framesDelay = pngDecodeData.delayTimes;
                    _ts.play();
                    // 返回精灵并将纹理材质设置为第一帧图像
                    return new Sprite(_ts.textures[0]);
                },
                'other': function () {
                    _ts.textures = [resources[imgSrc].texture];
                    return new Sprite(resources[imgSrc].texture);
                }
            };
            return funs[exeName]();
        };
        /**
         * 将apng缓存资源转换为纹理材质
         * @param  {object} resource    缓存资源
         * @return {object} 返回一个对象，包括apng的每帧时长及解码出来材质
         */
        Image.prototype.apngResourceToTextures = function (resource) {
            var obj = {
                delayTimes: [],
                textures: []
            }, buf = new Uint8Array(resource.data), upng = UPNG.decode(buf), rgba = UPNG.toRGBA8(upng), pngWidth = upng.width, pngHeight = upng.height, pngFramesLen = upng.frames.length, spriteSheet, canvas, ctx, imageData;
            // 记录下每帧的时间
            upng.frames.forEach(function (item, index) {
                obj.delayTimes.push(item.delay);
            });
            for (var i = 0, len = rgba.length; i < len; i++) {
                var item = rgba[i], data = new Uint8ClampedArray(item);
                canvas = document.createElement('canvas');
                canvas.width = pngWidth;
                canvas.height = pngHeight;
                ctx = canvas.getContext('2d');
                spriteSheet = new PIXI.BaseTexture.from(canvas);
                imageData = ctx.createImageData(pngWidth, pngHeight);
                imageData.data.set(data);
                ctx.putImageData(imageData, 0, 0);
                obj.textures.push(new PIXI.Texture(spriteSheet, new PIXI.Rectangle(0, 0, pngWidth, pngHeight)));
            }
            // document.body.appendChild(canvas);
            return obj;
        };
        /**
         * 将gif缓存资源转换为纹理材质
         * @param  {object} resource    缓存资源
         * @return {object} 返回一个对象，包括apng的每帧时长及解码出来材质
         */
        Image.prototype.gifResourceToTextures = function (resource) {
            var obj = {
                delayTimes: [],
                textures: []
            }, buf = new Uint8Array(resource.data), gif = new GifReader(buf), gifWidth = gif.width, gifHeight = gif.height, gifFramesLen = gif.numFrames(), gifFrameInfo, spriteSheet, canvas, ctx, imageData;
            for (var i = 0; i < gifFramesLen; i++) {
                //得到每帧的信息并将帧延迟信息保存起来
                gifFrameInfo = gif.frameInfo(i);
                obj.delayTimes.push(gifFrameInfo.delay * 10);
                canvas = document.createElement('canvas');
                canvas.width = gifWidth;
                canvas.height = gifHeight;
                ctx = canvas.getContext('2d');
                //创建一块空白的ImageData对象
                imageData = ctx.createImageData(gifWidth, gifHeight);
                //将第一帧转换为RGBA值，将赋予到图像区
                gif.decodeAndBlitFrameRGBA(i, imageData.data);
                //将上面创建的图像数据放回到画面上
                ctx.putImageData(imageData, 0, 0);
                spriteSheet = new PIXI.BaseTexture.fromCanvas(canvas);
                obj.textures.push(new PIXI.Texture(spriteSheet, new PIXI.Rectangle(0, 0, gifWidth, gifHeight)));
            }
            // document.body.appendChild(canvas);
            return obj;
        };
        return Image;
    }());

    return Image;

})));
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUGl4aUFwbmdBbmRHaWYuZXM2Iiwic291cmNlcyI6WyJzcmMvbGliL19nZXRFeGVOYW1lLmVzNiIsInNyYy9saWIvX29tZ2dpZi5lczYiLCJzcmMvbGliL191cG5nLmVzNiIsInNyYy9QaXhpQXBuZ0FuZEdpZi5lczYiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGRlZmF1bHQgKGZpbGVQYXRoKT0+e1xuICAgIGxldCBhTGlzdCA9IGZpbGVQYXRoLnNwbGl0KCcuJyk7XG4gICAgcmV0dXJuIGFMaXN0W2FMaXN0Lmxlbmd0aCAtIDFdO1xufTsiLCIvLyAoYykgRGVhbiBNY05hbWVlIDxkZWFuQGdtYWlsLmNvbT4sIDIwMTMuXG4vL1xuLy8gaHR0cHM6Ly9naXRodWIuY29tL2RlYW5tL29tZ2dpZlxuLy9cbi8vIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhIGNvcHlcbi8vIG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlIFwiU29mdHdhcmVcIiksIHRvXG4vLyBkZWFsIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmcgd2l0aG91dCBsaW1pdGF0aW9uIHRoZVxuLy8gcmlnaHRzIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCwgZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yXG4vLyBzZWxsIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXQgcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpc1xuLy8gZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZSBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZCBpblxuLy8gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTUyBPUlxuLy8gSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFksXG4vLyBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEVcbi8vIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sIERBTUFHRVMgT1IgT1RIRVJcbi8vIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HXG4vLyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTXG4vLyBJTiBUSEUgU09GVFdBUkUuXG4vL1xuLy8gb21nZ2lmIGlzIGEgSmF2YVNjcmlwdCBpbXBsZW1lbnRhdGlvbiBvZiBhIEdJRiA4OWEgZW5jb2RlciBhbmQgZGVjb2Rlcixcbi8vIGluY2x1ZGluZyBhbmltYXRpb24gYW5kIGNvbXByZXNzaW9uLiAgSXQgZG9lcyBub3QgcmVseSBvbiBhbnkgc3BlY2lmaWNcbi8vIHVuZGVybHlpbmcgc3lzdGVtLCBzbyBzaG91bGQgcnVuIGluIHRoZSBicm93c2VyLCBOb2RlLCBvciBQbGFzay5cblxuXCJ1c2Ugc3RyaWN0XCI7XG5cbmZ1bmN0aW9uIEdpZlJlYWRlcihidWYpIHtcbiAgdmFyIHAgPSAwO1xuXG4gIC8vIC0gSGVhZGVyIChHSUY4N2Egb3IgR0lGODlhKS5cbiAgaWYgKGJ1ZltwKytdICE9PSAweDQ3IHx8IGJ1ZltwKytdICE9PSAweDQ5IHx8IGJ1ZltwKytdICE9PSAweDQ2IHx8XG4gICAgYnVmW3ArK10gIT09IDB4MzggfHwgKGJ1ZltwKytdICsgMSAmIDB4ZmQpICE9PSAweDM4IHx8IGJ1ZltwKytdICE9PSAweDYxKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBHSUYgODdhLzg5YSBoZWFkZXIuXCIpO1xuICB9XG5cbiAgLy8gLSBMb2dpY2FsIFNjcmVlbiBEZXNjcmlwdG9yLlxuICB2YXIgd2lkdGggPSBidWZbcCsrXSB8IGJ1ZltwKytdIDw8IDg7XG4gIHZhciBoZWlnaHQgPSBidWZbcCsrXSB8IGJ1ZltwKytdIDw8IDg7XG4gIHZhciBwZjAgPSBidWZbcCsrXTsgLy8gPFBhY2tlZCBGaWVsZHM+LlxuICB2YXIgZ2xvYmFsX3BhbGV0dGVfZmxhZyA9IHBmMCA+PiA3O1xuICB2YXIgbnVtX2dsb2JhbF9jb2xvcnNfcG93MiA9IHBmMCAmIDB4NztcbiAgdmFyIG51bV9nbG9iYWxfY29sb3JzID0gMSA8PCAobnVtX2dsb2JhbF9jb2xvcnNfcG93MiArIDEpO1xuICB2YXIgYmFja2dyb3VuZCA9IGJ1ZltwKytdO1xuICBidWZbcCsrXTsgLy8gUGl4ZWwgYXNwZWN0IHJhdGlvICh1bnVzZWQ/KS5cblxuICB2YXIgZ2xvYmFsX3BhbGV0dGVfb2Zmc2V0ID0gbnVsbDtcbiAgdmFyIGdsb2JhbF9wYWxldHRlX3NpemUgPSBudWxsO1xuXG4gIGlmIChnbG9iYWxfcGFsZXR0ZV9mbGFnKSB7XG4gICAgZ2xvYmFsX3BhbGV0dGVfb2Zmc2V0ID0gcDtcbiAgICBnbG9iYWxfcGFsZXR0ZV9zaXplID0gbnVtX2dsb2JhbF9jb2xvcnM7XG4gICAgcCArPSBudW1fZ2xvYmFsX2NvbG9ycyAqIDM7IC8vIFNlZWsgcGFzdCBwYWxldHRlLlxuICB9XG5cbiAgdmFyIG5vX2VvZiA9IHRydWU7XG5cbiAgdmFyIGZyYW1lcyA9IFtdO1xuXG4gIHZhciBkZWxheSA9IDA7XG4gIHZhciB0cmFuc3BhcmVudF9pbmRleCA9IG51bGw7XG4gIHZhciBkaXNwb3NhbCA9IDA7IC8vIDAgLSBObyBkaXNwb3NhbCBzcGVjaWZpZWQuXG4gIHZhciBsb29wX2NvdW50ID0gbnVsbDtcblxuICB0aGlzLndpZHRoID0gd2lkdGg7XG4gIHRoaXMuaGVpZ2h0ID0gaGVpZ2h0O1xuXG4gIHdoaWxlIChub19lb2YgJiYgcCA8IGJ1Zi5sZW5ndGgpIHtcbiAgICBzd2l0Y2ggKGJ1ZltwKytdKSB7XG4gICAgICBjYXNlIDB4MjE6IC8vIEdyYXBoaWNzIENvbnRyb2wgRXh0ZW5zaW9uIEJsb2NrXG4gICAgICAgIHN3aXRjaCAoYnVmW3ArK10pIHtcbiAgICAgICAgICBjYXNlIDB4ZmY6IC8vIEFwcGxpY2F0aW9uIHNwZWNpZmljIGJsb2NrXG4gICAgICAgICAgICAvLyBUcnkgaWYgaXQncyBhIE5ldHNjYXBlIGJsb2NrICh3aXRoIGFuaW1hdGlvbiBsb29wIGNvdW50ZXIpLlxuICAgICAgICAgICAgaWYgKGJ1ZltwXSAhPT0gMHgwYiB8fCAvLyAyMSBGRiBhbHJlYWR5IHJlYWQsIGNoZWNrIGJsb2NrIHNpemUuXG4gICAgICAgICAgICAgIC8vIE5FVFNDQVBFMi4wXG4gICAgICAgICAgICAgIGJ1ZltwICsgMV0gPT0gMHg0ZSAmJiBidWZbcCArIDJdID09IDB4NDUgJiYgYnVmW3AgKyAzXSA9PSAweDU0ICYmXG4gICAgICAgICAgICAgIGJ1ZltwICsgNF0gPT0gMHg1MyAmJiBidWZbcCArIDVdID09IDB4NDMgJiYgYnVmW3AgKyA2XSA9PSAweDQxICYmXG4gICAgICAgICAgICAgIGJ1ZltwICsgN10gPT0gMHg1MCAmJiBidWZbcCArIDhdID09IDB4NDUgJiYgYnVmW3AgKyA5XSA9PSAweDMyICYmXG4gICAgICAgICAgICAgIGJ1ZltwICsgMTBdID09IDB4MmUgJiYgYnVmW3AgKyAxMV0gPT0gMHgzMCAmJlxuICAgICAgICAgICAgICAvLyBTdWItYmxvY2tcbiAgICAgICAgICAgICAgYnVmW3AgKyAxMl0gPT0gMHgwMyAmJiBidWZbcCArIDEzXSA9PSAweDAxICYmIGJ1ZltwICsgMTZdID09IDApIHtcbiAgICAgICAgICAgICAgcCArPSAxNDtcbiAgICAgICAgICAgICAgbG9vcF9jb3VudCA9IGJ1ZltwKytdIHwgYnVmW3ArK10gPDwgODtcbiAgICAgICAgICAgICAgcCsrOyAvLyBTa2lwIHRlcm1pbmF0b3IuXG4gICAgICAgICAgICB9IGVsc2UgeyAvLyBXZSBkb24ndCBrbm93IHdoYXQgaXQgaXMsIGp1c3QgdHJ5IHRvIGdldCBwYXN0IGl0LlxuICAgICAgICAgICAgICBwICs9IDEyO1xuICAgICAgICAgICAgICB3aGlsZSAodHJ1ZSkgeyAvLyBTZWVrIHRocm91Z2ggc3ViYmxvY2tzLlxuICAgICAgICAgICAgICAgIHZhciBibG9ja19zaXplID0gYnVmW3ArK107XG4gICAgICAgICAgICAgICAgLy8gQmFkIGJsb2NrIHNpemUgKGV4OiB1bmRlZmluZWQgZnJvbSBhbiBvdXQgb2YgYm91bmRzIHJlYWQpLlxuICAgICAgICAgICAgICAgIGlmICghKGJsb2NrX3NpemUgPj0gMCkpIHRocm93IEVycm9yKFwiSW52YWxpZCBibG9jayBzaXplXCIpO1xuICAgICAgICAgICAgICAgIGlmIChibG9ja19zaXplID09PSAwKSBicmVhazsgLy8gMCBzaXplIGlzIHRlcm1pbmF0b3JcbiAgICAgICAgICAgICAgICBwICs9IGJsb2NrX3NpemU7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgY2FzZSAweGY5OiAvLyBHcmFwaGljcyBDb250cm9sIEV4dGVuc2lvblxuICAgICAgICAgICAgaWYgKGJ1ZltwKytdICE9PSAweDQgfHwgYnVmW3AgKyA0XSAhPT0gMClcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBncmFwaGljcyBleHRlbnNpb24gYmxvY2suXCIpO1xuICAgICAgICAgICAgdmFyIHBmMSA9IGJ1ZltwKytdO1xuICAgICAgICAgICAgZGVsYXkgPSBidWZbcCsrXSB8IGJ1ZltwKytdIDw8IDg7XG4gICAgICAgICAgICB0cmFuc3BhcmVudF9pbmRleCA9IGJ1ZltwKytdO1xuICAgICAgICAgICAgaWYgKChwZjEgJiAxKSA9PT0gMCkgdHJhbnNwYXJlbnRfaW5kZXggPSBudWxsO1xuICAgICAgICAgICAgZGlzcG9zYWwgPSBwZjEgPj4gMiAmIDB4NztcbiAgICAgICAgICAgIHArKzsgLy8gU2tpcCB0ZXJtaW5hdG9yLlxuICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICBjYXNlIDB4ZmU6IC8vIENvbW1lbnQgRXh0ZW5zaW9uLlxuICAgICAgICAgICAgd2hpbGUgKHRydWUpIHsgLy8gU2VlayB0aHJvdWdoIHN1YmJsb2Nrcy5cbiAgICAgICAgICAgICAgdmFyIGJsb2NrX3NpemUgPSBidWZbcCsrXTtcbiAgICAgICAgICAgICAgLy8gQmFkIGJsb2NrIHNpemUgKGV4OiB1bmRlZmluZWQgZnJvbSBhbiBvdXQgb2YgYm91bmRzIHJlYWQpLlxuICAgICAgICAgICAgICBpZiAoIShibG9ja19zaXplID49IDApKSB0aHJvdyBFcnJvcihcIkludmFsaWQgYmxvY2sgc2l6ZVwiKTtcbiAgICAgICAgICAgICAgaWYgKGJsb2NrX3NpemUgPT09IDApIGJyZWFrOyAvLyAwIHNpemUgaXMgdGVybWluYXRvclxuICAgICAgICAgICAgICAvLyBjb25zb2xlLmxvZyhidWYuc2xpY2UocCwgcCtibG9ja19zaXplKS50b1N0cmluZygnYXNjaWknKSk7XG4gICAgICAgICAgICAgIHAgKz0gYmxvY2tfc2l6ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgXCJVbmtub3duIGdyYXBoaWMgY29udHJvbCBsYWJlbDogMHhcIiArIGJ1ZltwIC0gMV0udG9TdHJpbmcoMTYpKTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSAweDJjOiAvLyBJbWFnZSBEZXNjcmlwdG9yLlxuICAgICAgICB2YXIgeCA9IGJ1ZltwKytdIHwgYnVmW3ArK10gPDwgODtcbiAgICAgICAgdmFyIHkgPSBidWZbcCsrXSB8IGJ1ZltwKytdIDw8IDg7XG4gICAgICAgIHZhciB3ID0gYnVmW3ArK10gfCBidWZbcCsrXSA8PCA4O1xuICAgICAgICB2YXIgaCA9IGJ1ZltwKytdIHwgYnVmW3ArK10gPDwgODtcbiAgICAgICAgdmFyIHBmMiA9IGJ1ZltwKytdO1xuICAgICAgICB2YXIgbG9jYWxfcGFsZXR0ZV9mbGFnID0gcGYyID4+IDc7XG4gICAgICAgIHZhciBpbnRlcmxhY2VfZmxhZyA9IHBmMiA+PiA2ICYgMTtcbiAgICAgICAgdmFyIG51bV9sb2NhbF9jb2xvcnNfcG93MiA9IHBmMiAmIDB4NztcbiAgICAgICAgdmFyIG51bV9sb2NhbF9jb2xvcnMgPSAxIDw8IChudW1fbG9jYWxfY29sb3JzX3BvdzIgKyAxKTtcbiAgICAgICAgdmFyIHBhbGV0dGVfb2Zmc2V0ID0gZ2xvYmFsX3BhbGV0dGVfb2Zmc2V0O1xuICAgICAgICB2YXIgcGFsZXR0ZV9zaXplID0gZ2xvYmFsX3BhbGV0dGVfc2l6ZTtcbiAgICAgICAgdmFyIGhhc19sb2NhbF9wYWxldHRlID0gZmFsc2U7XG4gICAgICAgIGlmIChsb2NhbF9wYWxldHRlX2ZsYWcpIHtcbiAgICAgICAgICB2YXIgaGFzX2xvY2FsX3BhbGV0dGUgPSB0cnVlO1xuICAgICAgICAgIHBhbGV0dGVfb2Zmc2V0ID0gcDsgLy8gT3ZlcnJpZGUgd2l0aCBsb2NhbCBwYWxldHRlLlxuICAgICAgICAgIHBhbGV0dGVfc2l6ZSA9IG51bV9sb2NhbF9jb2xvcnM7XG4gICAgICAgICAgcCArPSBudW1fbG9jYWxfY29sb3JzICogMzsgLy8gU2VlayBwYXN0IHBhbGV0dGUuXG4gICAgICAgIH1cblxuICAgICAgICB2YXIgZGF0YV9vZmZzZXQgPSBwO1xuXG4gICAgICAgIHArKzsgLy8gY29kZXNpemVcbiAgICAgICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgICB2YXIgYmxvY2tfc2l6ZSA9IGJ1ZltwKytdO1xuICAgICAgICAgIC8vIEJhZCBibG9jayBzaXplIChleDogdW5kZWZpbmVkIGZyb20gYW4gb3V0IG9mIGJvdW5kcyByZWFkKS5cbiAgICAgICAgICBpZiAoIShibG9ja19zaXplID49IDApKSB0aHJvdyBFcnJvcihcIkludmFsaWQgYmxvY2sgc2l6ZVwiKTtcbiAgICAgICAgICBpZiAoYmxvY2tfc2l6ZSA9PT0gMCkgYnJlYWs7IC8vIDAgc2l6ZSBpcyB0ZXJtaW5hdG9yXG4gICAgICAgICAgcCArPSBibG9ja19zaXplO1xuICAgICAgICB9XG5cbiAgICAgICAgZnJhbWVzLnB1c2goe1xuICAgICAgICAgIHg6IHgsXG4gICAgICAgICAgeTogeSxcbiAgICAgICAgICB3aWR0aDogdyxcbiAgICAgICAgICBoZWlnaHQ6IGgsXG4gICAgICAgICAgaGFzX2xvY2FsX3BhbGV0dGU6IGhhc19sb2NhbF9wYWxldHRlLFxuICAgICAgICAgIHBhbGV0dGVfb2Zmc2V0OiBwYWxldHRlX29mZnNldCxcbiAgICAgICAgICBwYWxldHRlX3NpemU6IHBhbGV0dGVfc2l6ZSxcbiAgICAgICAgICBkYXRhX29mZnNldDogZGF0YV9vZmZzZXQsXG4gICAgICAgICAgZGF0YV9sZW5ndGg6IHAgLSBkYXRhX29mZnNldCxcbiAgICAgICAgICB0cmFuc3BhcmVudF9pbmRleDogdHJhbnNwYXJlbnRfaW5kZXgsXG4gICAgICAgICAgaW50ZXJsYWNlZDogISFpbnRlcmxhY2VfZmxhZyxcbiAgICAgICAgICBkZWxheTogZGVsYXksXG4gICAgICAgICAgZGlzcG9zYWw6IGRpc3Bvc2FsXG4gICAgICAgIH0pO1xuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSAweDNiOiAvLyBUcmFpbGVyIE1hcmtlciAoZW5kIG9mIGZpbGUpLlxuICAgICAgICBub19lb2YgPSBmYWxzZTtcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlVua25vd24gZ2lmIGJsb2NrOiAweFwiICsgYnVmW3AgLSAxXS50b1N0cmluZygxNikpO1xuICAgICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICB0aGlzLm51bUZyYW1lcyA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gZnJhbWVzLmxlbmd0aDtcbiAgfTtcblxuICB0aGlzLmxvb3BDb3VudCA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gbG9vcF9jb3VudDtcbiAgfTtcblxuICB0aGlzLmZyYW1lSW5mbyA9IGZ1bmN0aW9uIChmcmFtZV9udW0pIHtcbiAgICBpZiAoZnJhbWVfbnVtIDwgMCB8fCBmcmFtZV9udW0gPj0gZnJhbWVzLmxlbmd0aClcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkZyYW1lIGluZGV4IG91dCBvZiByYW5nZS5cIik7XG4gICAgcmV0dXJuIGZyYW1lc1tmcmFtZV9udW1dO1xuICB9XG5cbiAgdGhpcy5kZWNvZGVBbmRCbGl0RnJhbWVCR1JBID0gZnVuY3Rpb24gKGZyYW1lX251bSwgcGl4ZWxzKSB7XG4gICAgdmFyIGZyYW1lID0gdGhpcy5mcmFtZUluZm8oZnJhbWVfbnVtKTtcbiAgICB2YXIgbnVtX3BpeGVscyA9IGZyYW1lLndpZHRoICogZnJhbWUuaGVpZ2h0O1xuICAgIHZhciBpbmRleF9zdHJlYW0gPSBuZXcgVWludDhBcnJheShudW1fcGl4ZWxzKTsgLy8gQXQgbW9zdCA4LWJpdCBpbmRpY2VzLlxuICAgIEdpZlJlYWRlckxaV091dHB1dEluZGV4U3RyZWFtKFxuICAgICAgYnVmLCBmcmFtZS5kYXRhX29mZnNldCwgaW5kZXhfc3RyZWFtLCBudW1fcGl4ZWxzKTtcbiAgICB2YXIgcGFsZXR0ZV9vZmZzZXQgPSBmcmFtZS5wYWxldHRlX29mZnNldDtcblxuICAgIC8vIE5PVEUoZGVhbm0pOiBJdCBzZWVtcyB0byBiZSBtdWNoIGZhc3RlciB0byBjb21wYXJlIGluZGV4IHRvIDI1NiB0aGFuXG4gICAgLy8gdG8gPT09IG51bGwuICBOb3Qgc3VyZSB3aHksIGJ1dCBDb21wYXJlU3R1Yl9FUV9TVFJJQ1Qgc2hvd3MgdXAgaGlnaCBpblxuICAgIC8vIHRoZSBwcm9maWxlLCBub3Qgc3VyZSBpZiBpdCdzIHJlbGF0ZWQgdG8gdXNpbmcgYSBVaW50OEFycmF5LlxuICAgIHZhciB0cmFucyA9IGZyYW1lLnRyYW5zcGFyZW50X2luZGV4O1xuICAgIGlmICh0cmFucyA9PT0gbnVsbCkgdHJhbnMgPSAyNTY7XG5cbiAgICAvLyBXZSBhcmUgcG9zc2libHkganVzdCBibGl0dGluZyB0byBhIHBvcnRpb24gb2YgdGhlIGVudGlyZSBmcmFtZS5cbiAgICAvLyBUaGF0IGlzIGEgc3VicmVjdCB3aXRoaW4gdGhlIGZyYW1lcmVjdCwgc28gdGhlIGFkZGl0aW9uYWwgcGl4ZWxzXG4gICAgLy8gbXVzdCBiZSBza2lwcGVkIG92ZXIgYWZ0ZXIgd2UgZmluaXNoZWQgYSBzY2FubGluZS5cbiAgICB2YXIgZnJhbWV3aWR0aCA9IGZyYW1lLndpZHRoO1xuICAgIHZhciBmcmFtZXN0cmlkZSA9IHdpZHRoIC0gZnJhbWV3aWR0aDtcbiAgICB2YXIgeGxlZnQgPSBmcmFtZXdpZHRoOyAvLyBOdW1iZXIgb2Ygc3VicmVjdCBwaXhlbHMgbGVmdCBpbiBzY2FubGluZS5cblxuICAgIC8vIE91dHB1dCBpbmRpY2llcyBvZiB0aGUgdG9wIGxlZnQgYW5kIGJvdHRvbSByaWdodCBjb3JuZXJzIG9mIHRoZSBzdWJyZWN0LlxuICAgIHZhciBvcGJlZyA9ICgoZnJhbWUueSAqIHdpZHRoKSArIGZyYW1lLngpICogNDtcbiAgICB2YXIgb3BlbmQgPSAoKGZyYW1lLnkgKyBmcmFtZS5oZWlnaHQpICogd2lkdGggKyBmcmFtZS54KSAqIDQ7XG4gICAgdmFyIG9wID0gb3BiZWc7XG5cbiAgICB2YXIgc2NhbnN0cmlkZSA9IGZyYW1lc3RyaWRlICogNDtcblxuICAgIC8vIFVzZSBzY2Fuc3RyaWRlIHRvIHNraXAgcGFzdCB0aGUgcm93cyB3aGVuIGludGVybGFjaW5nLiAgVGhpcyBpcyBza2lwcGluZ1xuICAgIC8vIDcgcm93cyBmb3IgdGhlIGZpcnN0IHR3byBwYXNzZXMsIHRoZW4gMyB0aGVuIDEuXG4gICAgaWYgKGZyYW1lLmludGVybGFjZWQgPT09IHRydWUpIHtcbiAgICAgIHNjYW5zdHJpZGUgKz0gd2lkdGggKiA0ICogNzsgLy8gUGFzcyAxLlxuICAgIH1cblxuICAgIHZhciBpbnRlcmxhY2Vza2lwID0gODsgLy8gVHJhY2tpbmcgdGhlIHJvdyBpbnRlcnZhbCBpbiB0aGUgY3VycmVudCBwYXNzLlxuXG4gICAgZm9yICh2YXIgaSA9IDAsIGlsID0gaW5kZXhfc3RyZWFtLmxlbmd0aDsgaSA8IGlsOyArK2kpIHtcbiAgICAgIHZhciBpbmRleCA9IGluZGV4X3N0cmVhbVtpXTtcblxuICAgICAgaWYgKHhsZWZ0ID09PSAwKSB7IC8vIEJlZ2lubmluZyBvZiBuZXcgc2NhbiBsaW5lXG4gICAgICAgIG9wICs9IHNjYW5zdHJpZGU7XG4gICAgICAgIHhsZWZ0ID0gZnJhbWV3aWR0aDtcbiAgICAgICAgaWYgKG9wID49IG9wZW5kKSB7IC8vIENhdGNoIHRoZSB3cmFwIHRvIHN3aXRjaCBwYXNzZXMgd2hlbiBpbnRlcmxhY2luZy5cbiAgICAgICAgICBzY2Fuc3RyaWRlID0gZnJhbWVzdHJpZGUgKiA0ICsgd2lkdGggKiA0ICogKGludGVybGFjZXNraXAgLSAxKTtcbiAgICAgICAgICAvLyBpbnRlcmxhY2Vza2lwIC8gMiAqIDQgaXMgaW50ZXJsYWNlc2tpcCA8PCAxLlxuICAgICAgICAgIG9wID0gb3BiZWcgKyAoZnJhbWV3aWR0aCArIGZyYW1lc3RyaWRlKSAqIChpbnRlcmxhY2Vza2lwIDw8IDEpO1xuICAgICAgICAgIGludGVybGFjZXNraXAgPj49IDE7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGluZGV4ID09PSB0cmFucykge1xuICAgICAgICBvcCArPSA0O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIHIgPSBidWZbcGFsZXR0ZV9vZmZzZXQgKyBpbmRleCAqIDNdO1xuICAgICAgICB2YXIgZyA9IGJ1ZltwYWxldHRlX29mZnNldCArIGluZGV4ICogMyArIDFdO1xuICAgICAgICB2YXIgYiA9IGJ1ZltwYWxldHRlX29mZnNldCArIGluZGV4ICogMyArIDJdO1xuICAgICAgICBwaXhlbHNbb3ArK10gPSBiO1xuICAgICAgICBwaXhlbHNbb3ArK10gPSBnO1xuICAgICAgICBwaXhlbHNbb3ArK10gPSByO1xuICAgICAgICBwaXhlbHNbb3ArK10gPSAyNTU7XG4gICAgICB9XG4gICAgICAtLXhsZWZ0O1xuICAgIH1cbiAgfTtcblxuICAvLyBJIHdpbGwgZ28gdG8gY29weSBhbmQgcGFzdGUgaGVsbCBvbmUgZGF5Li4uXG4gIHRoaXMuZGVjb2RlQW5kQmxpdEZyYW1lUkdCQSA9IGZ1bmN0aW9uIChmcmFtZV9udW0sIHBpeGVscykge1xuICAgIHZhciBmcmFtZSA9IHRoaXMuZnJhbWVJbmZvKGZyYW1lX251bSk7XG4gICAgdmFyIG51bV9waXhlbHMgPSBmcmFtZS53aWR0aCAqIGZyYW1lLmhlaWdodDtcbiAgICB2YXIgaW5kZXhfc3RyZWFtID0gbmV3IFVpbnQ4QXJyYXkobnVtX3BpeGVscyk7IC8vIEF0IG1vc3QgOC1iaXQgaW5kaWNlcy5cbiAgICBHaWZSZWFkZXJMWldPdXRwdXRJbmRleFN0cmVhbShcbiAgICAgIGJ1ZiwgZnJhbWUuZGF0YV9vZmZzZXQsIGluZGV4X3N0cmVhbSwgbnVtX3BpeGVscyk7XG4gICAgdmFyIHBhbGV0dGVfb2Zmc2V0ID0gZnJhbWUucGFsZXR0ZV9vZmZzZXQ7XG5cbiAgICAvLyBOT1RFKGRlYW5tKTogSXQgc2VlbXMgdG8gYmUgbXVjaCBmYXN0ZXIgdG8gY29tcGFyZSBpbmRleCB0byAyNTYgdGhhblxuICAgIC8vIHRvID09PSBudWxsLiAgTm90IHN1cmUgd2h5LCBidXQgQ29tcGFyZVN0dWJfRVFfU1RSSUNUIHNob3dzIHVwIGhpZ2ggaW5cbiAgICAvLyB0aGUgcHJvZmlsZSwgbm90IHN1cmUgaWYgaXQncyByZWxhdGVkIHRvIHVzaW5nIGEgVWludDhBcnJheS5cbiAgICB2YXIgdHJhbnMgPSBmcmFtZS50cmFuc3BhcmVudF9pbmRleDtcbiAgICBpZiAodHJhbnMgPT09IG51bGwpIHRyYW5zID0gMjU2O1xuXG4gICAgLy8gV2UgYXJlIHBvc3NpYmx5IGp1c3QgYmxpdHRpbmcgdG8gYSBwb3J0aW9uIG9mIHRoZSBlbnRpcmUgZnJhbWUuXG4gICAgLy8gVGhhdCBpcyBhIHN1YnJlY3Qgd2l0aGluIHRoZSBmcmFtZXJlY3QsIHNvIHRoZSBhZGRpdGlvbmFsIHBpeGVsc1xuICAgIC8vIG11c3QgYmUgc2tpcHBlZCBvdmVyIGFmdGVyIHdlIGZpbmlzaGVkIGEgc2NhbmxpbmUuXG4gICAgdmFyIGZyYW1ld2lkdGggPSBmcmFtZS53aWR0aDtcbiAgICB2YXIgZnJhbWVzdHJpZGUgPSB3aWR0aCAtIGZyYW1ld2lkdGg7XG4gICAgdmFyIHhsZWZ0ID0gZnJhbWV3aWR0aDsgLy8gTnVtYmVyIG9mIHN1YnJlY3QgcGl4ZWxzIGxlZnQgaW4gc2NhbmxpbmUuXG5cbiAgICAvLyBPdXRwdXQgaW5kaWNpZXMgb2YgdGhlIHRvcCBsZWZ0IGFuZCBib3R0b20gcmlnaHQgY29ybmVycyBvZiB0aGUgc3VicmVjdC5cbiAgICB2YXIgb3BiZWcgPSAoKGZyYW1lLnkgKiB3aWR0aCkgKyBmcmFtZS54KSAqIDQ7XG4gICAgdmFyIG9wZW5kID0gKChmcmFtZS55ICsgZnJhbWUuaGVpZ2h0KSAqIHdpZHRoICsgZnJhbWUueCkgKiA0O1xuICAgIHZhciBvcCA9IG9wYmVnO1xuXG4gICAgdmFyIHNjYW5zdHJpZGUgPSBmcmFtZXN0cmlkZSAqIDQ7XG5cbiAgICAvLyBVc2Ugc2NhbnN0cmlkZSB0byBza2lwIHBhc3QgdGhlIHJvd3Mgd2hlbiBpbnRlcmxhY2luZy4gIFRoaXMgaXMgc2tpcHBpbmdcbiAgICAvLyA3IHJvd3MgZm9yIHRoZSBmaXJzdCB0d28gcGFzc2VzLCB0aGVuIDMgdGhlbiAxLlxuICAgIGlmIChmcmFtZS5pbnRlcmxhY2VkID09PSB0cnVlKSB7XG4gICAgICBzY2Fuc3RyaWRlICs9IHdpZHRoICogNCAqIDc7IC8vIFBhc3MgMS5cbiAgICB9XG5cbiAgICB2YXIgaW50ZXJsYWNlc2tpcCA9IDg7IC8vIFRyYWNraW5nIHRoZSByb3cgaW50ZXJ2YWwgaW4gdGhlIGN1cnJlbnQgcGFzcy5cblxuICAgIGZvciAodmFyIGkgPSAwLCBpbCA9IGluZGV4X3N0cmVhbS5sZW5ndGg7IGkgPCBpbDsgKytpKSB7XG4gICAgICB2YXIgaW5kZXggPSBpbmRleF9zdHJlYW1baV07XG5cbiAgICAgIGlmICh4bGVmdCA9PT0gMCkgeyAvLyBCZWdpbm5pbmcgb2YgbmV3IHNjYW4gbGluZVxuICAgICAgICBvcCArPSBzY2Fuc3RyaWRlO1xuICAgICAgICB4bGVmdCA9IGZyYW1ld2lkdGg7XG4gICAgICAgIGlmIChvcCA+PSBvcGVuZCkgeyAvLyBDYXRjaCB0aGUgd3JhcCB0byBzd2l0Y2ggcGFzc2VzIHdoZW4gaW50ZXJsYWNpbmcuXG4gICAgICAgICAgc2NhbnN0cmlkZSA9IGZyYW1lc3RyaWRlICogNCArIHdpZHRoICogNCAqIChpbnRlcmxhY2Vza2lwIC0gMSk7XG4gICAgICAgICAgLy8gaW50ZXJsYWNlc2tpcCAvIDIgKiA0IGlzIGludGVybGFjZXNraXAgPDwgMS5cbiAgICAgICAgICBvcCA9IG9wYmVnICsgKGZyYW1ld2lkdGggKyBmcmFtZXN0cmlkZSkgKiAoaW50ZXJsYWNlc2tpcCA8PCAxKTtcbiAgICAgICAgICBpbnRlcmxhY2Vza2lwID4+PSAxO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChpbmRleCA9PT0gdHJhbnMpIHtcbiAgICAgICAgb3AgKz0gNDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciByID0gYnVmW3BhbGV0dGVfb2Zmc2V0ICsgaW5kZXggKiAzXTtcbiAgICAgICAgdmFyIGcgPSBidWZbcGFsZXR0ZV9vZmZzZXQgKyBpbmRleCAqIDMgKyAxXTtcbiAgICAgICAgdmFyIGIgPSBidWZbcGFsZXR0ZV9vZmZzZXQgKyBpbmRleCAqIDMgKyAyXTtcbiAgICAgICAgcGl4ZWxzW29wKytdID0gcjtcbiAgICAgICAgcGl4ZWxzW29wKytdID0gZztcbiAgICAgICAgcGl4ZWxzW29wKytdID0gYjtcbiAgICAgICAgcGl4ZWxzW29wKytdID0gMjU1O1xuICAgICAgfVxuICAgICAgLS14bGVmdDtcbiAgICB9XG4gIH07XG59XG5cbmZ1bmN0aW9uIEdpZlJlYWRlckxaV091dHB1dEluZGV4U3RyZWFtKGNvZGVfc3RyZWFtLCBwLCBvdXRwdXQsIG91dHB1dF9sZW5ndGgpIHtcbiAgdmFyIG1pbl9jb2RlX3NpemUgPSBjb2RlX3N0cmVhbVtwKytdO1xuXG4gIHZhciBjbGVhcl9jb2RlID0gMSA8PCBtaW5fY29kZV9zaXplO1xuICB2YXIgZW9pX2NvZGUgPSBjbGVhcl9jb2RlICsgMTtcbiAgdmFyIG5leHRfY29kZSA9IGVvaV9jb2RlICsgMTtcblxuICB2YXIgY3VyX2NvZGVfc2l6ZSA9IG1pbl9jb2RlX3NpemUgKyAxOyAvLyBOdW1iZXIgb2YgYml0cyBwZXIgY29kZS5cbiAgLy8gTk9URTogVGhpcyBzaGFyZXMgdGhlIHNhbWUgbmFtZSBhcyB0aGUgZW5jb2RlciwgYnV0IGhhcyBhIGRpZmZlcmVudFxuICAvLyBtZWFuaW5nIGhlcmUuICBIZXJlIHRoaXMgbWFza3MgZWFjaCBjb2RlIGNvbWluZyBmcm9tIHRoZSBjb2RlIHN0cmVhbS5cbiAgdmFyIGNvZGVfbWFzayA9ICgxIDw8IGN1cl9jb2RlX3NpemUpIC0gMTtcbiAgdmFyIGN1cl9zaGlmdCA9IDA7XG4gIHZhciBjdXIgPSAwO1xuXG4gIHZhciBvcCA9IDA7IC8vIE91dHB1dCBwb2ludGVyLlxuXG4gIHZhciBzdWJibG9ja19zaXplID0gY29kZV9zdHJlYW1bcCsrXTtcblxuICAvLyBUT0RPKGRlYW5tKTogV291bGQgdXNpbmcgYSBUeXBlZEFycmF5IGJlIGFueSBmYXN0ZXI/ICBBdCBsZWFzdCBpdCB3b3VsZFxuICAvLyBzb2x2ZSB0aGUgZmFzdCBtb2RlIC8gYmFja2luZyBzdG9yZSB1bmNlcnRhaW50eS5cbiAgLy8gdmFyIGNvZGVfdGFibGUgPSBBcnJheSg0MDk2KTtcbiAgdmFyIGNvZGVfdGFibGUgPSBuZXcgSW50MzJBcnJheSg0MDk2KTsgLy8gQ2FuIGJlIHNpZ25lZCwgd2Ugb25seSB1c2UgMjAgYml0cy5cblxuICB2YXIgcHJldl9jb2RlID0gbnVsbDsgLy8gVHJhY2sgY29kZS0xLlxuXG4gIHdoaWxlICh0cnVlKSB7XG4gICAgLy8gUmVhZCB1cCB0byB0d28gYnl0ZXMsIG1ha2luZyBzdXJlIHdlIGFsd2F5cyAxMi1iaXRzIGZvciBtYXggc2l6ZWQgY29kZS5cbiAgICB3aGlsZSAoY3VyX3NoaWZ0IDwgMTYpIHtcbiAgICAgIGlmIChzdWJibG9ja19zaXplID09PSAwKSBicmVhazsgLy8gTm8gbW9yZSBkYXRhIHRvIGJlIHJlYWQuXG5cbiAgICAgIGN1ciB8PSBjb2RlX3N0cmVhbVtwKytdIDw8IGN1cl9zaGlmdDtcbiAgICAgIGN1cl9zaGlmdCArPSA4O1xuXG4gICAgICBpZiAoc3ViYmxvY2tfc2l6ZSA9PT0gMSkgeyAvLyBOZXZlciBsZXQgaXQgZ2V0IHRvIDAgdG8gaG9sZCBsb2dpYyBhYm92ZS5cbiAgICAgICAgc3ViYmxvY2tfc2l6ZSA9IGNvZGVfc3RyZWFtW3ArK107IC8vIE5leHQgc3ViYmxvY2suXG4gICAgICB9IGVsc2Uge1xuICAgICAgICAtLXN1YmJsb2NrX3NpemU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gVE9ETyhkZWFubSk6IFdlIHNob3VsZCBuZXZlciByZWFsbHkgZ2V0IGhlcmUsIHdlIHNob3VsZCBoYXZlIHJlY2VpdmVkXG4gICAgLy8gYW5kIEVPSS5cbiAgICBpZiAoY3VyX3NoaWZ0IDwgY3VyX2NvZGVfc2l6ZSlcbiAgICAgIGJyZWFrO1xuXG4gICAgdmFyIGNvZGUgPSBjdXIgJiBjb2RlX21hc2s7XG4gICAgY3VyID4+PSBjdXJfY29kZV9zaXplO1xuICAgIGN1cl9zaGlmdCAtPSBjdXJfY29kZV9zaXplO1xuXG4gICAgLy8gVE9ETyhkZWFubSk6IE1heWJlIHNob3VsZCBjaGVjayB0aGF0IHRoZSBmaXJzdCBjb2RlIHdhcyBhIGNsZWFyIGNvZGUsXG4gICAgLy8gYXQgbGVhc3QgdGhpcyBpcyB3aGF0IHlvdSdyZSBzdXBwb3NlZCB0byBkby4gIEJ1dCBhY3R1YWxseSBvdXIgZW5jb2RlclxuICAgIC8vIG5vdyBkb2Vzbid0IGVtaXQgYSBjbGVhciBjb2RlIGZpcnN0IGFueXdheS5cbiAgICBpZiAoY29kZSA9PT0gY2xlYXJfY29kZSkge1xuICAgICAgLy8gV2UgZG9uJ3QgYWN0dWFsbHkgaGF2ZSB0byBjbGVhciB0aGUgdGFibGUuICBUaGlzIGNvdWxkIGJlIGEgZ29vZCBpZGVhXG4gICAgICAvLyBmb3IgZ3JlYXRlciBlcnJvciBjaGVja2luZywgYnV0IHdlIGRvbid0IHJlYWxseSBkbyBhbnkgYW55d2F5LiAgV2VcbiAgICAgIC8vIHdpbGwganVzdCB0cmFjayBpdCB3aXRoIG5leHRfY29kZSBhbmQgb3ZlcndyaXRlIG9sZCBlbnRyaWVzLlxuXG4gICAgICBuZXh0X2NvZGUgPSBlb2lfY29kZSArIDE7XG4gICAgICBjdXJfY29kZV9zaXplID0gbWluX2NvZGVfc2l6ZSArIDE7XG4gICAgICBjb2RlX21hc2sgPSAoMSA8PCBjdXJfY29kZV9zaXplKSAtIDE7XG5cbiAgICAgIC8vIERvbid0IHVwZGF0ZSBwcmV2X2NvZGUgP1xuICAgICAgcHJldl9jb2RlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH0gZWxzZSBpZiAoY29kZSA9PT0gZW9pX2NvZGUpIHtcbiAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIC8vIFdlIGhhdmUgYSBzaW1pbGFyIHNpdHVhdGlvbiBhcyB0aGUgZGVjb2Rlciwgd2hlcmUgd2Ugd2FudCB0byBzdG9yZVxuICAgIC8vIHZhcmlhYmxlIGxlbmd0aCBlbnRyaWVzIChjb2RlIHRhYmxlIGVudHJpZXMpLCBidXQgd2Ugd2FudCB0byBkbyBpbiBhXG4gICAgLy8gZmFzdGVyIG1hbm5lciB0aGFuIGFuIGFycmF5IG9mIGFycmF5cy4gIFRoZSBjb2RlIGJlbG93IHN0b3JlcyBzb3J0IG9mIGFcbiAgICAvLyBsaW5rZWQgbGlzdCB3aXRoaW4gdGhlIGNvZGUgdGFibGUsIGFuZCB0aGVuIFwiY2hhc2VzXCIgdGhyb3VnaCBpdCB0b1xuICAgIC8vIGNvbnN0cnVjdCB0aGUgZGljdGlvbmFyeSBlbnRyaWVzLiAgV2hlbiBhIG5ldyBlbnRyeSBpcyBjcmVhdGVkLCBqdXN0IHRoZVxuICAgIC8vIGxhc3QgYnl0ZSBpcyBzdG9yZWQsIGFuZCB0aGUgcmVzdCAocHJlZml4KSBvZiB0aGUgZW50cnkgaXMgb25seVxuICAgIC8vIHJlZmVyZW5jZWQgYnkgaXRzIHRhYmxlIGVudHJ5LiAgVGhlbiB0aGUgY29kZSBjaGFzZXMgdGhyb3VnaCB0aGVcbiAgICAvLyBwcmVmaXhlcyB1bnRpbCBpdCByZWFjaGVzIGEgc2luZ2xlIGJ5dGUgY29kZS4gIFdlIGhhdmUgdG8gY2hhc2UgdHdpY2UsXG4gICAgLy8gZmlyc3QgdG8gY29tcHV0ZSB0aGUgbGVuZ3RoLCBhbmQgdGhlbiB0byBhY3R1YWxseSBjb3B5IHRoZSBkYXRhIHRvIHRoZVxuICAgIC8vIG91dHB1dCAoYmFja3dhcmRzLCBzaW5jZSB3ZSBrbm93IHRoZSBsZW5ndGgpLiAgVGhlIGFsdGVybmF0aXZlIHdvdWxkIGJlXG4gICAgLy8gc3RvcmluZyBzb21ldGhpbmcgaW4gYW4gaW50ZXJtZWRpYXRlIHN0YWNrLCBidXQgdGhhdCBkb2Vzbid0IG1ha2UgYW55XG4gICAgLy8gbW9yZSBzZW5zZS4gIEkgaW1wbGVtZW50ZWQgYW4gYXBwcm9hY2ggd2hlcmUgaXQgYWxzbyBzdG9yZWQgdGhlIGxlbmd0aFxuICAgIC8vIGluIHRoZSBjb2RlIHRhYmxlLCBhbHRob3VnaCBpdCdzIGEgYml0IHRyaWNreSBiZWNhdXNlIHlvdSBydW4gb3V0IG9mXG4gICAgLy8gYml0cyAoMTIgKyAxMiArIDgpLCBidXQgSSBkaWRuJ3QgbWVhc3VyZSBtdWNoIGltcHJvdmVtZW50cyAodGhlIHRhYmxlXG4gICAgLy8gZW50cmllcyBhcmUgZ2VuZXJhbGx5IG5vdCB0aGUgbG9uZykuICBFdmVuIHdoZW4gSSBjcmVhdGVkIGJlbmNobWFya3MgZm9yXG4gICAgLy8gdmVyeSBsb25nIHRhYmxlIGVudHJpZXMgdGhlIGNvbXBsZXhpdHkgZGlkIG5vdCBzZWVtIHdvcnRoIGl0LlxuICAgIC8vIFRoZSBjb2RlIHRhYmxlIHN0b3JlcyB0aGUgcHJlZml4IGVudHJ5IGluIDEyIGJpdHMgYW5kIHRoZW4gdGhlIHN1ZmZpeFxuICAgIC8vIGJ5dGUgaW4gOCBiaXRzLCBzbyBlYWNoIGVudHJ5IGlzIDIwIGJpdHMuXG5cbiAgICB2YXIgY2hhc2VfY29kZSA9IGNvZGUgPCBuZXh0X2NvZGUgPyBjb2RlIDogcHJldl9jb2RlO1xuXG4gICAgLy8gQ2hhc2Ugd2hhdCB3ZSB3aWxsIG91dHB1dCwgZWl0aGVyIHtDT0RFfSBvciB7Q09ERS0xfS5cbiAgICB2YXIgY2hhc2VfbGVuZ3RoID0gMDtcbiAgICB2YXIgY2hhc2UgPSBjaGFzZV9jb2RlO1xuICAgIHdoaWxlIChjaGFzZSA+IGNsZWFyX2NvZGUpIHtcbiAgICAgIGNoYXNlID0gY29kZV90YWJsZVtjaGFzZV0gPj4gODtcbiAgICAgICsrY2hhc2VfbGVuZ3RoO1xuICAgIH1cblxuICAgIHZhciBrID0gY2hhc2U7XG5cbiAgICB2YXIgb3BfZW5kID0gb3AgKyBjaGFzZV9sZW5ndGggKyAoY2hhc2VfY29kZSAhPT0gY29kZSA/IDEgOiAwKTtcbiAgICBpZiAob3BfZW5kID4gb3V0cHV0X2xlbmd0aCkge1xuICAgICAgY29uc29sZS5sb2coXCJXYXJuaW5nLCBnaWYgc3RyZWFtIGxvbmdlciB0aGFuIGV4cGVjdGVkLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBBbHJlYWR5IGhhdmUgdGhlIGZpcnN0IGJ5dGUgZnJvbSB0aGUgY2hhc2UsIG1pZ2h0IGFzIHdlbGwgd3JpdGUgaXQgZmFzdC5cbiAgICBvdXRwdXRbb3ArK10gPSBrO1xuXG4gICAgb3AgKz0gY2hhc2VfbGVuZ3RoO1xuICAgIHZhciBiID0gb3A7IC8vIFRyYWNrIHBvaW50ZXIsIHdyaXRpbmcgYmFja3dhcmRzLlxuXG4gICAgaWYgKGNoYXNlX2NvZGUgIT09IGNvZGUpIC8vIFRoZSBjYXNlIG9mIGVtaXR0aW5nIHtDT0RFLTF9ICsgay5cbiAgICAgIG91dHB1dFtvcCsrXSA9IGs7XG5cbiAgICBjaGFzZSA9IGNoYXNlX2NvZGU7XG4gICAgd2hpbGUgKGNoYXNlX2xlbmd0aC0tKSB7XG4gICAgICBjaGFzZSA9IGNvZGVfdGFibGVbY2hhc2VdO1xuICAgICAgb3V0cHV0Wy0tYl0gPSBjaGFzZSAmIDB4ZmY7IC8vIFdyaXRlIGJhY2t3YXJkcy5cbiAgICAgIGNoYXNlID4+PSA4OyAvLyBQdWxsIGRvd24gdG8gdGhlIHByZWZpeCBjb2RlLlxuICAgIH1cblxuICAgIGlmIChwcmV2X2NvZGUgIT09IG51bGwgJiYgbmV4dF9jb2RlIDwgNDA5Nikge1xuICAgICAgY29kZV90YWJsZVtuZXh0X2NvZGUrK10gPSBwcmV2X2NvZGUgPDwgOCB8IGs7XG4gICAgICAvLyBUT0RPKGRlYW5tKTogRmlndXJlIG91dCB0aGlzIGNsZWFyaW5nIHZzIGNvZGUgZ3Jvd3RoIGxvZ2ljIGJldHRlci4gIElcbiAgICAgIC8vIGhhdmUgYW4gZmVlbGluZyB0aGF0IGl0IHNob3VsZCBqdXN0IGhhcHBlbiBzb21ld2hlcmUgZWxzZSwgZm9yIG5vdyBpdFxuICAgICAgLy8gaXMgYXdrd2FyZCBiZXR3ZWVuIHdoZW4gd2UgZ3JvdyBwYXN0IHRoZSBtYXggYW5kIHRoZW4gaGl0IGEgY2xlYXIgY29kZS5cbiAgICAgIC8vIEZvciBub3cganVzdCBjaGVjayBpZiB3ZSBoaXQgdGhlIG1heCAxMi1iaXRzICh0aGVuIGEgY2xlYXIgY29kZSBzaG91bGRcbiAgICAgIC8vIGZvbGxvdywgYWxzbyBvZiBjb3Vyc2UgZW5jb2RlZCBpbiAxMi1iaXRzKS5cbiAgICAgIGlmIChuZXh0X2NvZGUgPj0gY29kZV9tYXNrICsgMSAmJiBjdXJfY29kZV9zaXplIDwgMTIpIHtcbiAgICAgICAgKytjdXJfY29kZV9zaXplO1xuICAgICAgICBjb2RlX21hc2sgPSBjb2RlX21hc2sgPDwgMSB8IDE7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcHJldl9jb2RlID0gY29kZTtcbiAgfVxuXG4gIGlmIChvcCAhPT0gb3V0cHV0X2xlbmd0aCkge1xuICAgIGNvbnNvbGUubG9nKFwiV2FybmluZywgZ2lmIHN0cmVhbSBzaG9ydGVyIHRoYW4gZXhwZWN0ZWQuXCIpO1xuICB9XG5cbiAgcmV0dXJuIG91dHB1dDtcbn1cblxuZXhwb3J0IGRlZmF1bHQgR2lmUmVhZGVyOyIsImltcG9ydCBwYWtvIGZyb20gJ3Bha28nXG5cbnZhciBVUE5HID0ge307XG5cbmlmIChVaW50OEFycmF5ICYmICFVaW50OEFycmF5LnByb3RvdHlwZS5zbGljZSkge1xuICAgIFVpbnQ4QXJyYXkucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24gKC4uLmFyZykge1xuICAgICAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkodGhpcykuc3ViYXJyYXkoLi4uYXJnKTtcbiAgICB9O1xufTtcbihmdW5jdGlvbiAoVVBORywgcGFrbykge1xuICAgIFVQTkcudG9SR0JBOCA9IGZ1bmN0aW9uIChvdXQpIHtcbiAgICAgICAgdmFyIHcgPSBvdXQud2lkdGgsXG4gICAgICAgICAgICBoID0gb3V0LmhlaWdodDtcbiAgICAgICAgaWYgKG91dC50YWJzLmFjVEwgPT0gbnVsbCkgcmV0dXJuIFtVUE5HLnRvUkdCQTguZGVjb2RlSW1hZ2Uob3V0LmRhdGEsIHcsIGgsIG91dCkuYnVmZmVyXTtcblxuICAgICAgICB2YXIgZnJtcyA9IFtdO1xuICAgICAgICBpZiAob3V0LmZyYW1lc1swXS5kYXRhID09IG51bGwpIG91dC5mcmFtZXNbMF0uZGF0YSA9IG91dC5kYXRhO1xuXG4gICAgICAgIHZhciBpbWcsIGVtcHR5ID0gbmV3IFVpbnQ4QXJyYXkodyAqIGggKiA0KTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBvdXQuZnJhbWVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgZnJtID0gb3V0LmZyYW1lc1tpXTtcbiAgICAgICAgICAgIHZhciBmeCA9IGZybS5yZWN0LngsXG4gICAgICAgICAgICAgICAgZnkgPSBmcm0ucmVjdC55LFxuICAgICAgICAgICAgICAgIGZ3ID0gZnJtLnJlY3Qud2lkdGgsXG4gICAgICAgICAgICAgICAgZmggPSBmcm0ucmVjdC5oZWlnaHQ7XG4gICAgICAgICAgICB2YXIgZmRhdGEgPSBVUE5HLnRvUkdCQTguZGVjb2RlSW1hZ2UoZnJtLmRhdGEsIGZ3LCBmaCwgb3V0KTtcblxuICAgICAgICAgICAgaWYgKGkgPT0gMCkgaW1nID0gZmRhdGE7XG4gICAgICAgICAgICBlbHNlIGlmIChmcm0uYmxlbmQgPT0gMCkgVVBORy5fY29weVRpbGUoZmRhdGEsIGZ3LCBmaCwgaW1nLCB3LCBoLCBmeCwgZnksIDApO1xuICAgICAgICAgICAgZWxzZSBpZiAoZnJtLmJsZW5kID09IDEpIFVQTkcuX2NvcHlUaWxlKGZkYXRhLCBmdywgZmgsIGltZywgdywgaCwgZngsIGZ5LCAxKTtcblxuICAgICAgICAgICAgZnJtcy5wdXNoKGltZy5idWZmZXIpO1xuICAgICAgICAgICAgaW1nID0gaW1nLnNsaWNlKDApO1xuXG4gICAgICAgICAgICBpZiAoZnJtLmRpc3Bvc2UgPT0gMCkge30gZWxzZSBpZiAoZnJtLmRpc3Bvc2UgPT0gMSkgVVBORy5fY29weVRpbGUoZW1wdHksIGZ3LCBmaCwgaW1nLCB3LCBoLCBmeCwgZnksIDApO1xuICAgICAgICAgICAgZWxzZSBpZiAoZnJtLmRpc3Bvc2UgPT0gMikge1xuICAgICAgICAgICAgICAgIHZhciBwaSA9IGkgLSAxO1xuICAgICAgICAgICAgICAgIHdoaWxlIChvdXQuZnJhbWVzW3BpXS5kaXNwb3NlID09IDIpIHBpLS07XG4gICAgICAgICAgICAgICAgaW1nID0gbmV3IFVpbnQ4QXJyYXkoZnJtc1twaV0pLnNsaWNlKDApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmcm1zO1xuICAgIH1cbiAgICBVUE5HLnRvUkdCQTguZGVjb2RlSW1hZ2UgPSBmdW5jdGlvbiAoZGF0YSwgdywgaCwgb3V0KSB7XG4gICAgICAgIHZhciBhcmVhID0gdyAqIGgsXG4gICAgICAgICAgICBicHAgPSBVUE5HLmRlY29kZS5fZ2V0QlBQKG91dCk7XG4gICAgICAgIHZhciBicGwgPSBNYXRoLmNlaWwodyAqIGJwcCAvIDgpOyAvLyBieXRlcyBwZXIgbGluZVxuICAgICAgICB2YXIgYmYgPSBuZXcgVWludDhBcnJheShhcmVhICogNCksXG4gICAgICAgICAgICBiZjMyID0gbmV3IFVpbnQzMkFycmF5KGJmLmJ1ZmZlcik7XG4gICAgICAgIHZhciBjdHlwZSA9IG91dC5jdHlwZSxcbiAgICAgICAgICAgIGRlcHRoID0gb3V0LmRlcHRoO1xuICAgICAgICB2YXIgcnMgPSBVUE5HLl9iaW4ucmVhZFVzaG9ydDtcblxuICAgICAgICAvL2NvbnNvbGUubG9nKGN0eXBlLCBkZXB0aCk7XG4gICAgICAgIGlmIChjdHlwZSA9PSA2KSB7IC8vIFJHQiArIGFscGhhXG4gICAgICAgICAgICB2YXIgcWFyZWEgPSBhcmVhIDw8IDI7XG4gICAgICAgICAgICBpZiAoZGVwdGggPT0gOClcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHFhcmVhOyBpKyspIHtcbiAgICAgICAgICAgICAgICAgICAgYmZbaV0gPSBkYXRhW2ldO1xuICAgICAgICAgICAgICAgICAgICAvKmlmKChpJjMpPT0zICYmIGRhdGFbaV0hPTApIGJmW2ldPTI1NTsqL1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChkZXB0aCA9PSAxNilcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHFhcmVhOyBpKyspIHtcbiAgICAgICAgICAgICAgICAgICAgYmZbaV0gPSBkYXRhW2kgPDwgMV07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKGN0eXBlID09IDIpIHsgLy8gUkdCXG4gICAgICAgICAgICB2YXIgdHMgPSBvdXQudGFic1tcInRSTlNcIl0sXG4gICAgICAgICAgICAgICAgdHIgPSAtMSxcbiAgICAgICAgICAgICAgICB0ZyA9IC0xLFxuICAgICAgICAgICAgICAgIHRiID0gLTE7XG4gICAgICAgICAgICBpZiAodHMpIHtcbiAgICAgICAgICAgICAgICB0ciA9IHRzWzBdO1xuICAgICAgICAgICAgICAgIHRnID0gdHNbMV07XG4gICAgICAgICAgICAgICAgdGIgPSB0c1syXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChkZXB0aCA9PSA4KVxuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJlYTsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBxaSA9IGkgPDwgMixcbiAgICAgICAgICAgICAgICAgICAgICAgIHRpID0gaSAqIDM7XG4gICAgICAgICAgICAgICAgICAgIGJmW3FpXSA9IGRhdGFbdGldO1xuICAgICAgICAgICAgICAgICAgICBiZltxaSArIDFdID0gZGF0YVt0aSArIDFdO1xuICAgICAgICAgICAgICAgICAgICBiZltxaSArIDJdID0gZGF0YVt0aSArIDJdO1xuICAgICAgICAgICAgICAgICAgICBiZltxaSArIDNdID0gMjU1O1xuICAgICAgICAgICAgICAgICAgICBpZiAodHIgIT0gLTEgJiYgZGF0YVt0aV0gPT0gdHIgJiYgZGF0YVt0aSArIDFdID09IHRnICYmIGRhdGFbdGkgKyAyXSA9PSB0YikgYmZbcWkgKyAzXSA9IDA7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGRlcHRoID09IDE2KVxuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJlYTsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBxaSA9IGkgPDwgMixcbiAgICAgICAgICAgICAgICAgICAgICAgIHRpID0gaSAqIDY7XG4gICAgICAgICAgICAgICAgICAgIGJmW3FpXSA9IGRhdGFbdGldO1xuICAgICAgICAgICAgICAgICAgICBiZltxaSArIDFdID0gZGF0YVt0aSArIDJdO1xuICAgICAgICAgICAgICAgICAgICBiZltxaSArIDJdID0gZGF0YVt0aSArIDRdO1xuICAgICAgICAgICAgICAgICAgICBiZltxaSArIDNdID0gMjU1O1xuICAgICAgICAgICAgICAgICAgICBpZiAodHIgIT0gLTEgJiYgcnMoZGF0YSwgdGkpID09IHRyICYmIHJzKGRhdGEsIHRpICsgMikgPT0gdGcgJiYgcnMoZGF0YSwgdGkgKyA0KSA9PSB0YikgYmZbcWkgKyAzXSA9IDA7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKGN0eXBlID09IDMpIHsgLy8gcGFsZXR0ZVxuICAgICAgICAgICAgdmFyIHAgPSBvdXQudGFic1tcIlBMVEVcIl0sXG4gICAgICAgICAgICAgICAgYXAgPSBvdXQudGFic1tcInRSTlNcIl0sXG4gICAgICAgICAgICAgICAgdGwgPSBhcCA/IGFwLmxlbmd0aCA6IDA7XG4gICAgICAgICAgICAvL2NvbnNvbGUubG9nKHAsIGFwKTtcbiAgICAgICAgICAgIGlmIChkZXB0aCA9PSAxKVxuICAgICAgICAgICAgICAgIGZvciAodmFyIHkgPSAwOyB5IDwgaDsgeSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBzMCA9IHkgKiBicGwsXG4gICAgICAgICAgICAgICAgICAgICAgICB0MCA9IHkgKiB3O1xuICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHc7IGkrKykge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHFpID0gKHQwICsgaSkgPDwgMixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBqID0gKChkYXRhW3MwICsgKGkgPj4gMyldID4+ICg3IC0gKChpICYgNykgPDwgMCkpKSAmIDEpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNqID0gMyAqIGo7XG4gICAgICAgICAgICAgICAgICAgICAgICBiZltxaV0gPSBwW2NqXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJmW3FpICsgMV0gPSBwW2NqICsgMV07XG4gICAgICAgICAgICAgICAgICAgICAgICBiZltxaSArIDJdID0gcFtjaiArIDJdO1xuICAgICAgICAgICAgICAgICAgICAgICAgYmZbcWkgKyAzXSA9IChqIDwgdGwpID8gYXBbal0gOiAyNTU7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoZGVwdGggPT0gMilcbiAgICAgICAgICAgICAgICBmb3IgKHZhciB5ID0gMDsgeSA8IGg7IHkrKykge1xuICAgICAgICAgICAgICAgICAgICB2YXIgczAgPSB5ICogYnBsLFxuICAgICAgICAgICAgICAgICAgICAgICAgdDAgPSB5ICogdztcbiAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB3OyBpKyspIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBxaSA9ICh0MCArIGkpIDw8IDIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaiA9ICgoZGF0YVtzMCArIChpID4+IDIpXSA+PiAoNiAtICgoaSAmIDMpIDw8IDEpKSkgJiAzKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjaiA9IDMgKiBqO1xuICAgICAgICAgICAgICAgICAgICAgICAgYmZbcWldID0gcFtjal07XG4gICAgICAgICAgICAgICAgICAgICAgICBiZltxaSArIDFdID0gcFtjaiArIDFdO1xuICAgICAgICAgICAgICAgICAgICAgICAgYmZbcWkgKyAyXSA9IHBbY2ogKyAyXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJmW3FpICsgM10gPSAoaiA8IHRsKSA/IGFwW2pdIDogMjU1O1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGRlcHRoID09IDQpXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgeSA9IDA7IHkgPCBoOyB5KyspIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHMwID0geSAqIGJwbCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHQwID0geSAqIHc7XG4gICAgICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdzsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgcWkgPSAodDAgKyBpKSA8PCAyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGogPSAoKGRhdGFbczAgKyAoaSA+PiAxKV0gPj4gKDQgLSAoKGkgJiAxKSA8PCAyKSkpICYgMTUpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNqID0gMyAqIGo7XG4gICAgICAgICAgICAgICAgICAgICAgICBiZltxaV0gPSBwW2NqXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJmW3FpICsgMV0gPSBwW2NqICsgMV07XG4gICAgICAgICAgICAgICAgICAgICAgICBiZltxaSArIDJdID0gcFtjaiArIDJdO1xuICAgICAgICAgICAgICAgICAgICAgICAgYmZbcWkgKyAzXSA9IChqIDwgdGwpID8gYXBbal0gOiAyNTU7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoZGVwdGggPT0gOClcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFyZWE7IGkrKykge1xuICAgICAgICAgICAgICAgICAgICB2YXIgcWkgPSBpIDw8IDIsXG4gICAgICAgICAgICAgICAgICAgICAgICBqID0gZGF0YVtpXSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNqID0gMyAqIGo7XG4gICAgICAgICAgICAgICAgICAgIGJmW3FpXSA9IHBbY2pdO1xuICAgICAgICAgICAgICAgICAgICBiZltxaSArIDFdID0gcFtjaiArIDFdO1xuICAgICAgICAgICAgICAgICAgICBiZltxaSArIDJdID0gcFtjaiArIDJdO1xuICAgICAgICAgICAgICAgICAgICBiZltxaSArIDNdID0gKGogPCB0bCkgPyBhcFtqXSA6IDI1NTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoY3R5cGUgPT0gNCkgeyAvLyBncmF5ICsgYWxwaGFcbiAgICAgICAgICAgIGlmIChkZXB0aCA9PSA4KVxuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJlYTsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBxaSA9IGkgPDwgMixcbiAgICAgICAgICAgICAgICAgICAgICAgIGRpID0gaSA8PCAxLFxuICAgICAgICAgICAgICAgICAgICAgICAgZ3IgPSBkYXRhW2RpXTtcbiAgICAgICAgICAgICAgICAgICAgYmZbcWldID0gZ3I7XG4gICAgICAgICAgICAgICAgICAgIGJmW3FpICsgMV0gPSBncjtcbiAgICAgICAgICAgICAgICAgICAgYmZbcWkgKyAyXSA9IGdyO1xuICAgICAgICAgICAgICAgICAgICBiZltxaSArIDNdID0gZGF0YVtkaSArIDFdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChkZXB0aCA9PSAxNilcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFyZWE7IGkrKykge1xuICAgICAgICAgICAgICAgICAgICB2YXIgcWkgPSBpIDw8IDIsXG4gICAgICAgICAgICAgICAgICAgICAgICBkaSA9IGkgPDwgMixcbiAgICAgICAgICAgICAgICAgICAgICAgIGdyID0gZGF0YVtkaV07XG4gICAgICAgICAgICAgICAgICAgIGJmW3FpXSA9IGdyO1xuICAgICAgICAgICAgICAgICAgICBiZltxaSArIDFdID0gZ3I7XG4gICAgICAgICAgICAgICAgICAgIGJmW3FpICsgMl0gPSBncjtcbiAgICAgICAgICAgICAgICAgICAgYmZbcWkgKyAzXSA9IGRhdGFbZGkgKyAyXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoY3R5cGUgPT0gMCkgeyAvLyBncmF5XG4gICAgICAgICAgICB2YXIgdHIgPSBvdXQudGFic1tcInRSTlNcIl0gPyBvdXQudGFic1tcInRSTlNcIl0gOiAtMTtcbiAgICAgICAgICAgIGlmIChkZXB0aCA9PSAxKVxuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJlYTsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBnciA9IDI1NSAqICgoZGF0YVtpID4+IDNdID4+ICg3IC0gKChpICYgNykpKSkgJiAxKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGFsID0gKGdyID09IHRyICogMjU1KSA/IDAgOiAyNTU7XG4gICAgICAgICAgICAgICAgICAgIGJmMzJbaV0gPSAoYWwgPDwgMjQpIHwgKGdyIDw8IDE2KSB8IChnciA8PCA4KSB8IGdyO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChkZXB0aCA9PSAyKVxuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJlYTsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBnciA9IDg1ICogKChkYXRhW2kgPj4gMl0gPj4gKDYgLSAoKGkgJiAzKSA8PCAxKSkpICYgMyksXG4gICAgICAgICAgICAgICAgICAgICAgICBhbCA9IChnciA9PSB0ciAqIDg1KSA/IDAgOiAyNTU7XG4gICAgICAgICAgICAgICAgICAgIGJmMzJbaV0gPSAoYWwgPDwgMjQpIHwgKGdyIDw8IDE2KSB8IChnciA8PCA4KSB8IGdyO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChkZXB0aCA9PSA0KVxuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJlYTsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBnciA9IDE3ICogKChkYXRhW2kgPj4gMV0gPj4gKDQgLSAoKGkgJiAxKSA8PCAyKSkpICYgMTUpLFxuICAgICAgICAgICAgICAgICAgICAgICAgYWwgPSAoZ3IgPT0gdHIgKiAxNykgPyAwIDogMjU1O1xuICAgICAgICAgICAgICAgICAgICBiZjMyW2ldID0gKGFsIDw8IDI0KSB8IChnciA8PCAxNikgfCAoZ3IgPDwgOCkgfCBncjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoZGVwdGggPT0gOClcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFyZWE7IGkrKykge1xuICAgICAgICAgICAgICAgICAgICB2YXIgZ3IgPSBkYXRhW2ldLFxuICAgICAgICAgICAgICAgICAgICAgICAgYWwgPSAoZ3IgPT0gdHIpID8gMCA6IDI1NTtcbiAgICAgICAgICAgICAgICAgICAgYmYzMltpXSA9IChhbCA8PCAyNCkgfCAoZ3IgPDwgMTYpIHwgKGdyIDw8IDgpIHwgZ3I7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGRlcHRoID09IDE2KVxuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJlYTsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBnciA9IGRhdGFbaSA8PCAxXSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGFsID0gKHJzKGRhdGEsIGkgPDwgMSkgPT0gdHIpID8gMCA6IDI1NTtcbiAgICAgICAgICAgICAgICAgICAgYmYzMltpXSA9IChhbCA8PCAyNCkgfCAoZ3IgPDwgMTYpIHwgKGdyIDw8IDgpIHwgZ3I7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBiZjtcbiAgICB9XG5cbiAgICBVUE5HLmRlY29kZSA9IGZ1bmN0aW9uIChidWZmKSB7XG4gICAgICAgIHZhciBkYXRhID0gbmV3IFVpbnQ4QXJyYXkoYnVmZiksXG4gICAgICAgICAgICBvZmZzZXQgPSA4LFxuICAgICAgICAgICAgYmluID0gVVBORy5fYmluLFxuICAgICAgICAgICAgclVzID0gYmluLnJlYWRVc2hvcnQsXG4gICAgICAgICAgICByVWkgPSBiaW4ucmVhZFVpbnQ7XG4gICAgICAgIHZhciBvdXQgPSB7XG4gICAgICAgICAgICB0YWJzOiB7fSxcbiAgICAgICAgICAgIGZyYW1lczogW11cbiAgICAgICAgfTtcbiAgICAgICAgdmFyIGRkID0gbmV3IFVpbnQ4QXJyYXkoZGF0YS5sZW5ndGgpLFxuICAgICAgICAgICAgZG9mZiA9IDA7IC8vIHB1dCBhbGwgSURBVCBkYXRhIGludG8gaXRcbiAgICAgICAgdmFyIGZkLCBmb2ZmID0gMDsgLy8gZnJhbWVzXG4gICAgICAgIHZhciBtZ2NrID0gWzB4ODksIDB4NTAsIDB4NGUsIDB4NDcsIDB4MGQsIDB4MGEsIDB4MWEsIDB4MGFdO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IDg7IGkrKylcbiAgICAgICAgICAgIGlmIChkYXRhW2ldICE9IG1nY2tbaV0pIHRocm93IFwiVGhlIGlucHV0IGlzIG5vdCBhIFBORyBmaWxlIVwiO1xuXG4gICAgICAgIHdoaWxlIChvZmZzZXQgPCBkYXRhLmxlbmd0aCkge1xuICAgICAgICAgICAgdmFyIGxlbiA9IGJpbi5yZWFkVWludChkYXRhLCBvZmZzZXQpO1xuICAgICAgICAgICAgb2Zmc2V0ICs9IDQ7XG4gICAgICAgICAgICB2YXIgdHlwZSA9IGJpbi5yZWFkQVNDSUkoZGF0YSwgb2Zmc2V0LCA0KTtcbiAgICAgICAgICAgIG9mZnNldCArPSA0O1xuICAgICAgICAgICAgLy9jb25zb2xlLmxvZyh0eXBlLGxlbik7XG4gICAgICAgICAgICBpZiAodHlwZSA9PSBcIklIRFJcIikge1xuICAgICAgICAgICAgICAgIFVQTkcuZGVjb2RlLl9JSERSKGRhdGEsIG9mZnNldCwgb3V0KTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PSBcIklEQVRcIikge1xuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspIGRkW2RvZmYgKyBpXSA9IGRhdGFbb2Zmc2V0ICsgaV07XG4gICAgICAgICAgICAgICAgZG9mZiArPSBsZW47XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHR5cGUgPT0gXCJhY1RMXCIpIHtcbiAgICAgICAgICAgICAgICBvdXQudGFic1t0eXBlXSA9IHtcbiAgICAgICAgICAgICAgICAgICAgbnVtX2ZyYW1lczogclVpKGRhdGEsIG9mZnNldCksXG4gICAgICAgICAgICAgICAgICAgIG51bV9wbGF5czogclVpKGRhdGEsIG9mZnNldCArIDQpXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBmZCA9IG5ldyBVaW50OEFycmF5KGRhdGEubGVuZ3RoKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PSBcImZjVExcIikge1xuICAgICAgICAgICAgICAgIGlmIChmb2ZmICE9IDApIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGZyID0gb3V0LmZyYW1lc1tvdXQuZnJhbWVzLmxlbmd0aCAtIDFdO1xuICAgICAgICAgICAgICAgICAgICBmci5kYXRhID0gVVBORy5kZWNvZGUuX2RlY29tcHJlc3Mob3V0LCBmZC5zbGljZSgwLCBmb2ZmKSwgZnIucmVjdC53aWR0aCwgZnIucmVjdC5oZWlnaHQpO1xuICAgICAgICAgICAgICAgICAgICBmb2ZmID0gMDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdmFyIHJjdCA9IHtcbiAgICAgICAgICAgICAgICAgICAgeDogclVpKGRhdGEsIG9mZnNldCArIDEyKSxcbiAgICAgICAgICAgICAgICAgICAgeTogclVpKGRhdGEsIG9mZnNldCArIDE2KSxcbiAgICAgICAgICAgICAgICAgICAgd2lkdGg6IHJVaShkYXRhLCBvZmZzZXQgKyA0KSxcbiAgICAgICAgICAgICAgICAgICAgaGVpZ2h0OiByVWkoZGF0YSwgb2Zmc2V0ICsgOClcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIHZhciBkZWwgPSByVXMoZGF0YSwgb2Zmc2V0ICsgMjIpO1xuICAgICAgICAgICAgICAgIGRlbCA9IHJVcyhkYXRhLCBvZmZzZXQgKyAyMCkgLyAoZGVsID09IDAgPyAxMDAgOiBkZWwpO1xuICAgICAgICAgICAgICAgIHZhciBmcm0gPSB7XG4gICAgICAgICAgICAgICAgICAgIHJlY3Q6IHJjdCxcbiAgICAgICAgICAgICAgICAgICAgZGVsYXk6IE1hdGgucm91bmQoZGVsICogMTAwMCksXG4gICAgICAgICAgICAgICAgICAgIGRpc3Bvc2U6IGRhdGFbb2Zmc2V0ICsgMjRdLFxuICAgICAgICAgICAgICAgICAgICBibGVuZDogZGF0YVtvZmZzZXQgKyAyNV1cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIC8vY29uc29sZS5sb2coZnJtKTtcbiAgICAgICAgICAgICAgICBvdXQuZnJhbWVzLnB1c2goZnJtKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PSBcImZkQVRcIikge1xuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuIC0gNDsgaSsrKSBmZFtmb2ZmICsgaV0gPSBkYXRhW29mZnNldCArIGkgKyA0XTtcbiAgICAgICAgICAgICAgICBmb2ZmICs9IGxlbiAtIDQ7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHR5cGUgPT0gXCJwSFlzXCIpIHtcbiAgICAgICAgICAgICAgICBvdXQudGFic1t0eXBlXSA9IFtiaW4ucmVhZFVpbnQoZGF0YSwgb2Zmc2V0KSwgYmluLnJlYWRVaW50KGRhdGEsIG9mZnNldCArIDQpLCBkYXRhW29mZnNldCArIDhdXTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PSBcImNIUk1cIikge1xuICAgICAgICAgICAgICAgIG91dC50YWJzW3R5cGVdID0gW107XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCA4OyBpKyspIG91dC50YWJzW3R5cGVdLnB1c2goYmluLnJlYWRVaW50KGRhdGEsIG9mZnNldCArIGkgKiA0KSk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHR5cGUgPT0gXCJ0RVh0XCIpIHtcbiAgICAgICAgICAgICAgICBpZiAob3V0LnRhYnNbdHlwZV0gPT0gbnVsbCkgb3V0LnRhYnNbdHlwZV0gPSB7fTtcbiAgICAgICAgICAgICAgICB2YXIgbnogPSBiaW4ubmV4dFplcm8oZGF0YSwgb2Zmc2V0KTtcbiAgICAgICAgICAgICAgICB2YXIga2V5dyA9IGJpbi5yZWFkQVNDSUkoZGF0YSwgb2Zmc2V0LCBueiAtIG9mZnNldCk7XG4gICAgICAgICAgICAgICAgdmFyIHRleHQgPSBiaW4ucmVhZEFTQ0lJKGRhdGEsIG56ICsgMSwgb2Zmc2V0ICsgbGVuIC0gbnogLSAxKTtcbiAgICAgICAgICAgICAgICBvdXQudGFic1t0eXBlXVtrZXl3XSA9IHRleHQ7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHR5cGUgPT0gXCJpVFh0XCIpIHtcbiAgICAgICAgICAgICAgICBpZiAob3V0LnRhYnNbdHlwZV0gPT0gbnVsbCkgb3V0LnRhYnNbdHlwZV0gPSB7fTtcbiAgICAgICAgICAgICAgICB2YXIgbnogPSAwLFxuICAgICAgICAgICAgICAgICAgICBvZmYgPSBvZmZzZXQ7XG4gICAgICAgICAgICAgICAgbnogPSBiaW4ubmV4dFplcm8oZGF0YSwgb2ZmKTtcbiAgICAgICAgICAgICAgICB2YXIga2V5dyA9IGJpbi5yZWFkQVNDSUkoZGF0YSwgb2ZmLCBueiAtIG9mZik7XG4gICAgICAgICAgICAgICAgb2ZmID0gbnogKyAxO1xuICAgICAgICAgICAgICAgIHZhciBjZmxhZyA9IGRhdGFbb2ZmXSxcbiAgICAgICAgICAgICAgICAgICAgY21ldGggPSBkYXRhW29mZiArIDFdO1xuICAgICAgICAgICAgICAgIG9mZiArPSAyO1xuICAgICAgICAgICAgICAgIG56ID0gYmluLm5leHRaZXJvKGRhdGEsIG9mZik7XG4gICAgICAgICAgICAgICAgdmFyIGx0YWcgPSBiaW4ucmVhZEFTQ0lJKGRhdGEsIG9mZiwgbnogLSBvZmYpO1xuICAgICAgICAgICAgICAgIG9mZiA9IG56ICsgMTtcbiAgICAgICAgICAgICAgICBueiA9IGJpbi5uZXh0WmVybyhkYXRhLCBvZmYpO1xuICAgICAgICAgICAgICAgIHZhciB0a2V5dyA9IGJpbi5yZWFkVVRGOChkYXRhLCBvZmYsIG56IC0gb2ZmKTtcbiAgICAgICAgICAgICAgICBvZmYgPSBueiArIDE7XG4gICAgICAgICAgICAgICAgdmFyIHRleHQgPSBiaW4ucmVhZFVURjgoZGF0YSwgb2ZmLCBsZW4gLSAob2ZmIC0gb2Zmc2V0KSk7XG4gICAgICAgICAgICAgICAgb3V0LnRhYnNbdHlwZV1ba2V5d10gPSB0ZXh0O1xuICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlID09IFwiUExURVwiKSB7XG4gICAgICAgICAgICAgICAgb3V0LnRhYnNbdHlwZV0gPSBiaW4ucmVhZEJ5dGVzKGRhdGEsIG9mZnNldCwgbGVuKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PSBcImhJU1RcIikge1xuICAgICAgICAgICAgICAgIHZhciBwbCA9IG91dC50YWJzW1wiUExURVwiXS5sZW5ndGggLyAzO1xuICAgICAgICAgICAgICAgIG91dC50YWJzW3R5cGVdID0gW107XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwbDsgaSsrKSBvdXQudGFic1t0eXBlXS5wdXNoKHJVcyhkYXRhLCBvZmZzZXQgKyBpICogMikpO1xuICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlID09IFwidFJOU1wiKSB7XG4gICAgICAgICAgICAgICAgaWYgKG91dC5jdHlwZSA9PSAzKSBvdXQudGFic1t0eXBlXSA9IGJpbi5yZWFkQnl0ZXMoZGF0YSwgb2Zmc2V0LCBsZW4pO1xuICAgICAgICAgICAgICAgIGVsc2UgaWYgKG91dC5jdHlwZSA9PSAwKSBvdXQudGFic1t0eXBlXSA9IHJVcyhkYXRhLCBvZmZzZXQpO1xuICAgICAgICAgICAgICAgIGVsc2UgaWYgKG91dC5jdHlwZSA9PSAyKSBvdXQudGFic1t0eXBlXSA9IFtyVXMoZGF0YSwgb2Zmc2V0KSwgclVzKGRhdGEsIG9mZnNldCArIDIpLCByVXMoZGF0YSwgb2Zmc2V0ICsgNCldO1xuICAgICAgICAgICAgICAgIC8vZWxzZSBjb25zb2xlLmxvZyhcInRSTlMgZm9yIHVuc3VwcG9ydGVkIGNvbG9yIHR5cGVcIixvdXQuY3R5cGUsIGxlbik7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHR5cGUgPT0gXCJnQU1BXCIpIG91dC50YWJzW3R5cGVdID0gYmluLnJlYWRVaW50KGRhdGEsIG9mZnNldCkgLyAxMDAwMDA7XG4gICAgICAgICAgICBlbHNlIGlmICh0eXBlID09IFwic1JHQlwiKSBvdXQudGFic1t0eXBlXSA9IGRhdGFbb2Zmc2V0XTtcbiAgICAgICAgICAgIGVsc2UgaWYgKHR5cGUgPT0gXCJiS0dEXCIpIHtcbiAgICAgICAgICAgICAgICBpZiAob3V0LmN0eXBlID09IDAgfHwgb3V0LmN0eXBlID09IDQpIG91dC50YWJzW3R5cGVdID0gW3JVcyhkYXRhLCBvZmZzZXQpXTtcbiAgICAgICAgICAgICAgICBlbHNlIGlmIChvdXQuY3R5cGUgPT0gMiB8fCBvdXQuY3R5cGUgPT0gNikgb3V0LnRhYnNbdHlwZV0gPSBbclVzKGRhdGEsIG9mZnNldCksIHJVcyhkYXRhLCBvZmZzZXQgKyAyKSwgclVzKGRhdGEsIG9mZnNldCArIDQpXTtcbiAgICAgICAgICAgICAgICBlbHNlIGlmIChvdXQuY3R5cGUgPT0gMykgb3V0LnRhYnNbdHlwZV0gPSBkYXRhW29mZnNldF07XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHR5cGUgPT0gXCJJRU5EXCIpIHtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG9mZnNldCArPSBsZW47XG4gICAgICAgICAgICB2YXIgY3JjID0gYmluLnJlYWRVaW50KGRhdGEsIG9mZnNldCk7XG4gICAgICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZm9mZiAhPSAwKSB7XG4gICAgICAgICAgICB2YXIgZnIgPSBvdXQuZnJhbWVzW291dC5mcmFtZXMubGVuZ3RoIC0gMV07XG4gICAgICAgICAgICBmci5kYXRhID0gVVBORy5kZWNvZGUuX2RlY29tcHJlc3Mob3V0LCBmZC5zbGljZSgwLCBmb2ZmKSwgZnIucmVjdC53aWR0aCwgZnIucmVjdC5oZWlnaHQpO1xuICAgICAgICAgICAgZm9mZiA9IDA7XG4gICAgICAgIH1cbiAgICAgICAgb3V0LmRhdGEgPSBVUE5HLmRlY29kZS5fZGVjb21wcmVzcyhvdXQsIGRkLCBvdXQud2lkdGgsIG91dC5oZWlnaHQpO1xuXG4gICAgICAgIGRlbGV0ZSBvdXQuY29tcHJlc3M7XG4gICAgICAgIGRlbGV0ZSBvdXQuaW50ZXJsYWNlO1xuICAgICAgICBkZWxldGUgb3V0LmZpbHRlcjtcbiAgICAgICAgcmV0dXJuIG91dDtcbiAgICB9XG5cbiAgICBVUE5HLmRlY29kZS5fZGVjb21wcmVzcyA9IGZ1bmN0aW9uIChvdXQsIGRkLCB3LCBoKSB7XG4gICAgICAgIGlmIChvdXQuY29tcHJlc3MgPT0gMCkgZGQgPSBVUE5HLmRlY29kZS5faW5mbGF0ZShkZCk7XG5cbiAgICAgICAgaWYgKG91dC5pbnRlcmxhY2UgPT0gMCkgZGQgPSBVUE5HLmRlY29kZS5fZmlsdGVyWmVybyhkZCwgb3V0LCAwLCB3LCBoKTtcbiAgICAgICAgZWxzZSBpZiAob3V0LmludGVybGFjZSA9PSAxKSBkZCA9IFVQTkcuZGVjb2RlLl9yZWFkSW50ZXJsYWNlKGRkLCBvdXQpO1xuICAgICAgICByZXR1cm4gZGQ7XG4gICAgfVxuXG4gICAgVVBORy5kZWNvZGUuX2luZmxhdGUgPSBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICByZXR1cm4gcGFrb1tcImluZmxhdGVcIl0oZGF0YSk7XG4gICAgfVxuXG4gICAgVVBORy5kZWNvZGUuX3JlYWRJbnRlcmxhY2UgPSBmdW5jdGlvbiAoZGF0YSwgb3V0KSB7XG4gICAgICAgIHZhciB3ID0gb3V0LndpZHRoLFxuICAgICAgICAgICAgaCA9IG91dC5oZWlnaHQ7XG4gICAgICAgIHZhciBicHAgPSBVUE5HLmRlY29kZS5fZ2V0QlBQKG91dCksXG4gICAgICAgICAgICBjYnBwID0gYnBwID4+IDMsXG4gICAgICAgICAgICBicGwgPSBNYXRoLmNlaWwodyAqIGJwcCAvIDgpO1xuICAgICAgICB2YXIgaW1nID0gbmV3IFVpbnQ4QXJyYXkoaCAqIGJwbCk7XG4gICAgICAgIHZhciBkaSA9IDA7XG5cbiAgICAgICAgdmFyIHN0YXJ0aW5nX3JvdyA9IFswLCAwLCA0LCAwLCAyLCAwLCAxXTtcbiAgICAgICAgdmFyIHN0YXJ0aW5nX2NvbCA9IFswLCA0LCAwLCAyLCAwLCAxLCAwXTtcbiAgICAgICAgdmFyIHJvd19pbmNyZW1lbnQgPSBbOCwgOCwgOCwgNCwgNCwgMiwgMl07XG4gICAgICAgIHZhciBjb2xfaW5jcmVtZW50ID0gWzgsIDgsIDQsIDQsIDIsIDIsIDFdO1xuXG4gICAgICAgIHZhciBwYXNzID0gMDtcbiAgICAgICAgd2hpbGUgKHBhc3MgPCA3KSB7XG4gICAgICAgICAgICB2YXIgcmkgPSByb3dfaW5jcmVtZW50W3Bhc3NdLFxuICAgICAgICAgICAgICAgIGNpID0gY29sX2luY3JlbWVudFtwYXNzXTtcbiAgICAgICAgICAgIHZhciBzdyA9IDAsXG4gICAgICAgICAgICAgICAgc2ggPSAwO1xuICAgICAgICAgICAgdmFyIGNyID0gc3RhcnRpbmdfcm93W3Bhc3NdO1xuICAgICAgICAgICAgd2hpbGUgKGNyIDwgaCkge1xuICAgICAgICAgICAgICAgIGNyICs9IHJpO1xuICAgICAgICAgICAgICAgIHNoKys7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXIgY2MgPSBzdGFydGluZ19jb2xbcGFzc107XG4gICAgICAgICAgICB3aGlsZSAoY2MgPCB3KSB7XG4gICAgICAgICAgICAgICAgY2MgKz0gY2k7XG4gICAgICAgICAgICAgICAgc3crKztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciBicGxsID0gTWF0aC5jZWlsKHN3ICogYnBwIC8gOCk7XG4gICAgICAgICAgICBVUE5HLmRlY29kZS5fZmlsdGVyWmVybyhkYXRhLCBvdXQsIGRpLCBzdywgc2gpO1xuXG4gICAgICAgICAgICB2YXIgeSA9IDAsXG4gICAgICAgICAgICAgICAgcm93ID0gc3RhcnRpbmdfcm93W3Bhc3NdO1xuICAgICAgICAgICAgd2hpbGUgKHJvdyA8IGgpIHtcbiAgICAgICAgICAgICAgICB2YXIgY29sID0gc3RhcnRpbmdfY29sW3Bhc3NdO1xuICAgICAgICAgICAgICAgIHZhciBjZGkgPSAoZGkgKyB5ICogYnBsbCkgPDwgMztcblxuICAgICAgICAgICAgICAgIHdoaWxlIChjb2wgPCB3KSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChicHAgPT0gMSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHZhbCA9IGRhdGFbY2RpID4+IDNdO1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFsID0gKHZhbCA+PiAoNyAtIChjZGkgJiA3KSkpICYgMTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGltZ1tyb3cgKiBicGwgKyAoY29sID4+IDMpXSB8PSAodmFsIDw8ICg3IC0gKChjb2wgJiAzKSA8PCAwKSkpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGlmIChicHAgPT0gMikge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHZhbCA9IGRhdGFbY2RpID4+IDNdO1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFsID0gKHZhbCA+PiAoNiAtIChjZGkgJiA3KSkpICYgMztcbiAgICAgICAgICAgICAgICAgICAgICAgIGltZ1tyb3cgKiBicGwgKyAoY29sID4+IDIpXSB8PSAodmFsIDw8ICg2IC0gKChjb2wgJiAzKSA8PCAxKSkpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGlmIChicHAgPT0gNCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHZhbCA9IGRhdGFbY2RpID4+IDNdO1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFsID0gKHZhbCA+PiAoNCAtIChjZGkgJiA3KSkpICYgMTU7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbWdbcm93ICogYnBsICsgKGNvbCA+PiAxKV0gfD0gKHZhbCA8PCAoNCAtICgoY29sICYgMSkgPDwgMikpKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBpZiAoYnBwID49IDgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBpaSA9IHJvdyAqIGJwbCArIGNvbCAqIGNicHA7XG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGNicHA7IGorKykgaW1nW2lpICsgal0gPSBkYXRhWyhjZGkgPj4gMykgKyBqXTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBjZGkgKz0gYnBwO1xuICAgICAgICAgICAgICAgICAgICBjb2wgKz0gY2k7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHkrKztcbiAgICAgICAgICAgICAgICByb3cgKz0gcmk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoc3cgKiBzaCAhPSAwKSBkaSArPSBzaCAqICgxICsgYnBsbCk7XG4gICAgICAgICAgICBwYXNzID0gcGFzcyArIDE7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGltZztcbiAgICB9XG5cbiAgICBVUE5HLmRlY29kZS5fZ2V0QlBQID0gZnVuY3Rpb24gKG91dCkge1xuICAgICAgICB2YXIgbm9jID0gWzEsIG51bGwsIDMsIDEsIDIsIG51bGwsIDRdW291dC5jdHlwZV07XG4gICAgICAgIHJldHVybiBub2MgKiBvdXQuZGVwdGg7XG4gICAgfVxuXG4gICAgVVBORy5kZWNvZGUuX2ZpbHRlclplcm8gPSBmdW5jdGlvbiAoZGF0YSwgb3V0LCBvZmYsIHcsIGgpIHtcbiAgICAgICAgdmFyIGJwcCA9IFVQTkcuZGVjb2RlLl9nZXRCUFAob3V0KSxcbiAgICAgICAgICAgIGJwbCA9IE1hdGguY2VpbCh3ICogYnBwIC8gOCksXG4gICAgICAgICAgICBwYWV0aCA9IFVQTkcuZGVjb2RlLl9wYWV0aDtcbiAgICAgICAgYnBwID0gTWF0aC5jZWlsKGJwcCAvIDgpO1xuXG4gICAgICAgIGZvciAodmFyIHkgPSAwOyB5IDwgaDsgeSsrKSB7XG4gICAgICAgICAgICB2YXIgaSA9IG9mZiArIHkgKiBicGwsXG4gICAgICAgICAgICAgICAgZGkgPSBpICsgeSArIDE7XG4gICAgICAgICAgICB2YXIgdHlwZSA9IGRhdGFbZGkgLSAxXTtcblxuICAgICAgICAgICAgaWYgKHR5cGUgPT0gMClcbiAgICAgICAgICAgICAgICBmb3IgKHZhciB4ID0gMDsgeCA8IGJwbDsgeCsrKSBkYXRhW2kgKyB4XSA9IGRhdGFbZGkgKyB4XTtcbiAgICAgICAgICAgIGVsc2UgaWYgKHR5cGUgPT0gMSkge1xuICAgICAgICAgICAgICAgIGZvciAodmFyIHggPSAwOyB4IDwgYnBwOyB4KyspIGRhdGFbaSArIHhdID0gZGF0YVtkaSArIHhdO1xuICAgICAgICAgICAgICAgIGZvciAodmFyIHggPSBicHA7IHggPCBicGw7IHgrKykgZGF0YVtpICsgeF0gPSAoZGF0YVtkaSArIHhdICsgZGF0YVtpICsgeCAtIGJwcF0pICYgMjU1O1xuICAgICAgICAgICAgfSBlbHNlIGlmICh5ID09IDApIHtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciB4ID0gMDsgeCA8IGJwcDsgeCsrKSBkYXRhW2kgKyB4XSA9IGRhdGFbZGkgKyB4XTtcbiAgICAgICAgICAgICAgICBpZiAodHlwZSA9PSAyKVxuICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciB4ID0gYnBwOyB4IDwgYnBsOyB4KyspIGRhdGFbaSArIHhdID0gKGRhdGFbZGkgKyB4XSkgJiAyNTU7XG4gICAgICAgICAgICAgICAgaWYgKHR5cGUgPT0gMylcbiAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIgeCA9IGJwcDsgeCA8IGJwbDsgeCsrKSBkYXRhW2kgKyB4XSA9IChkYXRhW2RpICsgeF0gKyAoZGF0YVtpICsgeCAtIGJwcF0gPj4gMSkpICYgMjU1O1xuICAgICAgICAgICAgICAgIGlmICh0eXBlID09IDQpXG4gICAgICAgICAgICAgICAgICAgIGZvciAodmFyIHggPSBicHA7IHggPCBicGw7IHgrKykgZGF0YVtpICsgeF0gPSAoZGF0YVtkaSArIHhdICsgcGFldGgoZGF0YVtpICsgeCAtIGJwcF0sIDAsIDApKSAmIDI1NTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgaWYgKHR5cGUgPT0gMikge1xuICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciB4ID0gMDsgeCA8IGJwbDsgeCsrKSBkYXRhW2kgKyB4XSA9IChkYXRhW2RpICsgeF0gKyBkYXRhW2kgKyB4IC0gYnBsXSkgJiAyNTU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKHR5cGUgPT0gMykge1xuICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciB4ID0gMDsgeCA8IGJwcDsgeCsrKSBkYXRhW2kgKyB4XSA9IChkYXRhW2RpICsgeF0gKyAoZGF0YVtpICsgeCAtIGJwbF0gPj4gMSkpICYgMjU1O1xuICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciB4ID0gYnBwOyB4IDwgYnBsOyB4KyspIGRhdGFbaSArIHhdID0gKGRhdGFbZGkgKyB4XSArICgoZGF0YVtpICsgeCAtIGJwbF0gKyBkYXRhW2kgKyB4IC0gYnBwXSkgPj4gMSkpICYgMjU1O1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICh0eXBlID09IDQpIHtcbiAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIgeCA9IDA7IHggPCBicHA7IHgrKykgZGF0YVtpICsgeF0gPSAoZGF0YVtkaSArIHhdICsgcGFldGgoMCwgZGF0YVtpICsgeCAtIGJwbF0sIDApKSAmIDI1NTtcbiAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIgeCA9IGJwcDsgeCA8IGJwbDsgeCsrKSBkYXRhW2kgKyB4XSA9IChkYXRhW2RpICsgeF0gKyBwYWV0aChkYXRhW2kgKyB4IC0gYnBwXSwgZGF0YVtpICsgeCAtIGJwbF0sIGRhdGFbaSArIHggLSBicHAgLSBicGxdKSkgJiAyNTU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBkYXRhO1xuICAgIH1cblxuICAgIFVQTkcuZGVjb2RlLl9wYWV0aCA9IGZ1bmN0aW9uIChhLCBiLCBjKSB7XG4gICAgICAgIHZhciBwID0gYSArIGIgLSBjLFxuICAgICAgICAgICAgcGEgPSBNYXRoLmFicyhwIC0gYSksXG4gICAgICAgICAgICBwYiA9IE1hdGguYWJzKHAgLSBiKSxcbiAgICAgICAgICAgIHBjID0gTWF0aC5hYnMocCAtIGMpO1xuICAgICAgICBpZiAocGEgPD0gcGIgJiYgcGEgPD0gcGMpIHJldHVybiBhO1xuICAgICAgICBlbHNlIGlmIChwYiA8PSBwYykgcmV0dXJuIGI7XG4gICAgICAgIHJldHVybiBjO1xuICAgIH1cblxuICAgIFVQTkcuZGVjb2RlLl9JSERSID0gZnVuY3Rpb24gKGRhdGEsIG9mZnNldCwgb3V0KSB7XG4gICAgICAgIHZhciBiaW4gPSBVUE5HLl9iaW47XG4gICAgICAgIG91dC53aWR0aCA9IGJpbi5yZWFkVWludChkYXRhLCBvZmZzZXQpO1xuICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgb3V0LmhlaWdodCA9IGJpbi5yZWFkVWludChkYXRhLCBvZmZzZXQpO1xuICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgb3V0LmRlcHRoID0gZGF0YVtvZmZzZXRdO1xuICAgICAgICBvZmZzZXQrKztcbiAgICAgICAgb3V0LmN0eXBlID0gZGF0YVtvZmZzZXRdO1xuICAgICAgICBvZmZzZXQrKztcbiAgICAgICAgb3V0LmNvbXByZXNzID0gZGF0YVtvZmZzZXRdO1xuICAgICAgICBvZmZzZXQrKztcbiAgICAgICAgb3V0LmZpbHRlciA9IGRhdGFbb2Zmc2V0XTtcbiAgICAgICAgb2Zmc2V0Kys7XG4gICAgICAgIG91dC5pbnRlcmxhY2UgPSBkYXRhW29mZnNldF07XG4gICAgICAgIG9mZnNldCsrO1xuICAgIH1cblxuICAgIFVQTkcuX2JpbiA9IHtcbiAgICAgICAgbmV4dFplcm86IGZ1bmN0aW9uIChkYXRhLCBwKSB7XG4gICAgICAgICAgICB3aGlsZSAoZGF0YVtwXSAhPSAwKSBwKys7XG4gICAgICAgICAgICByZXR1cm4gcDtcbiAgICAgICAgfSxcbiAgICAgICAgcmVhZFVzaG9ydDogZnVuY3Rpb24gKGJ1ZmYsIHApIHtcbiAgICAgICAgICAgIHJldHVybiAoYnVmZltwXSA8PCA4KSB8IGJ1ZmZbcCArIDFdO1xuICAgICAgICB9LFxuICAgICAgICB3cml0ZVVzaG9ydDogZnVuY3Rpb24gKGJ1ZmYsIHAsIG4pIHtcbiAgICAgICAgICAgIGJ1ZmZbcF0gPSAobiA+PiA4KSAmIDI1NTtcbiAgICAgICAgICAgIGJ1ZmZbcCArIDFdID0gbiAmIDI1NTtcbiAgICAgICAgfSxcbiAgICAgICAgcmVhZFVpbnQ6IGZ1bmN0aW9uIChidWZmLCBwKSB7XG4gICAgICAgICAgICByZXR1cm4gKGJ1ZmZbcF0gKiAoMjU2ICogMjU2ICogMjU2KSkgKyAoKGJ1ZmZbcCArIDFdIDw8IDE2KSB8IChidWZmW3AgKyAyXSA8PCA4KSB8IGJ1ZmZbcCArIDNdKTtcbiAgICAgICAgfSxcbiAgICAgICAgd3JpdGVVaW50OiBmdW5jdGlvbiAoYnVmZiwgcCwgbikge1xuICAgICAgICAgICAgYnVmZltwXSA9IChuID4+IDI0KSAmIDI1NTtcbiAgICAgICAgICAgIGJ1ZmZbcCArIDFdID0gKG4gPj4gMTYpICYgMjU1O1xuICAgICAgICAgICAgYnVmZltwICsgMl0gPSAobiA+PiA4KSAmIDI1NTtcbiAgICAgICAgICAgIGJ1ZmZbcCArIDNdID0gbiAmIDI1NTtcbiAgICAgICAgfSxcbiAgICAgICAgcmVhZEFTQ0lJOiBmdW5jdGlvbiAoYnVmZiwgcCwgbCkge1xuICAgICAgICAgICAgdmFyIHMgPSBcIlwiO1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsOyBpKyspIHMgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShidWZmW3AgKyBpXSk7XG4gICAgICAgICAgICByZXR1cm4gcztcbiAgICAgICAgfSxcbiAgICAgICAgd3JpdGVBU0NJSTogZnVuY3Rpb24gKGRhdGEsIHAsIHMpIHtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcy5sZW5ndGg7IGkrKykgZGF0YVtwICsgaV0gPSBzLmNoYXJDb2RlQXQoaSk7XG4gICAgICAgIH0sXG4gICAgICAgIHJlYWRCeXRlczogZnVuY3Rpb24gKGJ1ZmYsIHAsIGwpIHtcbiAgICAgICAgICAgIHZhciBhcnIgPSBbXTtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbDsgaSsrKSBhcnIucHVzaChidWZmW3AgKyBpXSk7XG4gICAgICAgICAgICByZXR1cm4gYXJyO1xuICAgICAgICB9LFxuICAgICAgICBwYWQ6IGZ1bmN0aW9uIChuKSB7XG4gICAgICAgICAgICByZXR1cm4gbi5sZW5ndGggPCAyID8gXCIwXCIgKyBuIDogbjtcbiAgICAgICAgfSxcbiAgICAgICAgcmVhZFVURjg6IGZ1bmN0aW9uIChidWZmLCBwLCBsKSB7XG4gICAgICAgICAgICB2YXIgcyA9IFwiXCIsXG4gICAgICAgICAgICAgICAgbnM7XG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGw7IGkrKykgcyArPSBcIiVcIiArIFVQTkcuX2Jpbi5wYWQoYnVmZltwICsgaV0udG9TdHJpbmcoMTYpKTtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgbnMgPSBkZWNvZGVVUklDb21wb25lbnQocyk7XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFVQTkcuX2Jpbi5yZWFkQVNDSUkoYnVmZiwgcCwgbCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gbnM7XG4gICAgICAgIH1cbiAgICB9XG4gICAgVVBORy5fY29weVRpbGUgPSBmdW5jdGlvbiAoc2IsIHN3LCBzaCwgdGIsIHR3LCB0aCwgeG9mZiwgeW9mZiwgbW9kZSkge1xuICAgICAgICB2YXIgdyA9IE1hdGgubWluKHN3LCB0dyksXG4gICAgICAgICAgICBoID0gTWF0aC5taW4oc2gsIHRoKTtcbiAgICAgICAgdmFyIHNpID0gMCxcbiAgICAgICAgICAgIHRpID0gMDtcbiAgICAgICAgZm9yICh2YXIgeSA9IDA7IHkgPCBoOyB5KyspXG4gICAgICAgICAgICBmb3IgKHZhciB4ID0gMDsgeCA8IHc7IHgrKykge1xuICAgICAgICAgICAgICAgIGlmICh4b2ZmID49IDAgJiYgeW9mZiA+PSAwKSB7XG4gICAgICAgICAgICAgICAgICAgIHNpID0gKHkgKiBzdyArIHgpIDw8IDI7XG4gICAgICAgICAgICAgICAgICAgIHRpID0gKCh5b2ZmICsgeSkgKiB0dyArIHhvZmYgKyB4KSA8PCAyO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHNpID0gKCgteW9mZiArIHkpICogc3cgLSB4b2ZmICsgeCkgPDwgMjtcbiAgICAgICAgICAgICAgICAgICAgdGkgPSAoeSAqIHR3ICsgeCkgPDwgMjtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAobW9kZSA9PSAwKSB7XG4gICAgICAgICAgICAgICAgICAgIHRiW3RpXSA9IHNiW3NpXTtcbiAgICAgICAgICAgICAgICAgICAgdGJbdGkgKyAxXSA9IHNiW3NpICsgMV07XG4gICAgICAgICAgICAgICAgICAgIHRiW3RpICsgMl0gPSBzYltzaSArIDJdO1xuICAgICAgICAgICAgICAgICAgICB0Ylt0aSArIDNdID0gc2Jbc2kgKyAzXTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKG1vZGUgPT0gMSkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgZmEgPSBzYltzaSArIDNdICogKDEgLyAyNTUpLFxuICAgICAgICAgICAgICAgICAgICAgICAgZnIgPSBzYltzaV0gKiBmYSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGZnID0gc2Jbc2kgKyAxXSAqIGZhLFxuICAgICAgICAgICAgICAgICAgICAgICAgZmIgPSBzYltzaSArIDJdICogZmE7XG4gICAgICAgICAgICAgICAgICAgIHZhciBiYSA9IHRiW3RpICsgM10gKiAoMSAvIDI1NSksXG4gICAgICAgICAgICAgICAgICAgICAgICBiciA9IHRiW3RpXSAqIGJhLFxuICAgICAgICAgICAgICAgICAgICAgICAgYmcgPSB0Ylt0aSArIDFdICogYmEsXG4gICAgICAgICAgICAgICAgICAgICAgICBiYiA9IHRiW3RpICsgMl0gKiBiYTtcblxuICAgICAgICAgICAgICAgICAgICB2YXIgaWZhID0gMSAtIGZhLFxuICAgICAgICAgICAgICAgICAgICAgICAgb2EgPSBmYSArIGJhICogaWZhLFxuICAgICAgICAgICAgICAgICAgICAgICAgaW9hID0gKG9hID09IDAgPyAwIDogMSAvIG9hKTtcbiAgICAgICAgICAgICAgICAgICAgdGJbdGkgKyAzXSA9IDI1NSAqIG9hO1xuICAgICAgICAgICAgICAgICAgICB0Ylt0aSArIDBdID0gKGZyICsgYnIgKiBpZmEpICogaW9hO1xuICAgICAgICAgICAgICAgICAgICB0Ylt0aSArIDFdID0gKGZnICsgYmcgKiBpZmEpICogaW9hO1xuICAgICAgICAgICAgICAgICAgICB0Ylt0aSArIDJdID0gKGZiICsgYmIgKiBpZmEpICogaW9hO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAobW9kZSA9PSAyKSB7IC8vIGNvcHkgb25seSBkaWZmZXJlbmNlcywgb3RoZXJ3aXNlIHplcm9cbiAgICAgICAgICAgICAgICAgICAgdmFyIGZhID0gc2Jbc2kgKyAzXSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGZyID0gc2Jbc2ldLFxuICAgICAgICAgICAgICAgICAgICAgICAgZmcgPSBzYltzaSArIDFdLFxuICAgICAgICAgICAgICAgICAgICAgICAgZmIgPSBzYltzaSArIDJdO1xuICAgICAgICAgICAgICAgICAgICB2YXIgYmEgPSB0Ylt0aSArIDNdLFxuICAgICAgICAgICAgICAgICAgICAgICAgYnIgPSB0Ylt0aV0sXG4gICAgICAgICAgICAgICAgICAgICAgICBiZyA9IHRiW3RpICsgMV0sXG4gICAgICAgICAgICAgICAgICAgICAgICBiYiA9IHRiW3RpICsgMl07XG4gICAgICAgICAgICAgICAgICAgIGlmIChmYSA9PSBiYSAmJiBmciA9PSBiciAmJiBmZyA9PSBiZyAmJiBmYiA9PSBiYikge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGJbdGldID0gMDtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRiW3RpICsgMV0gPSAwO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGJbdGkgKyAyXSA9IDA7XG4gICAgICAgICAgICAgICAgICAgICAgICB0Ylt0aSArIDNdID0gMDtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRiW3RpXSA9IGZyO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGJbdGkgKyAxXSA9IGZnO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGJbdGkgKyAyXSA9IGZiO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGJbdGkgKyAzXSA9IGZhO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChtb2RlID09IDMpIHsgLy8gY2hlY2sgaWYgY2FuIGJlIGJsZW5kZWRcbiAgICAgICAgICAgICAgICAgICAgdmFyIGZhID0gc2Jbc2kgKyAzXSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGZyID0gc2Jbc2ldLFxuICAgICAgICAgICAgICAgICAgICAgICAgZmcgPSBzYltzaSArIDFdLFxuICAgICAgICAgICAgICAgICAgICAgICAgZmIgPSBzYltzaSArIDJdO1xuICAgICAgICAgICAgICAgICAgICB2YXIgYmEgPSB0Ylt0aSArIDNdLFxuICAgICAgICAgICAgICAgICAgICAgICAgYnIgPSB0Ylt0aV0sXG4gICAgICAgICAgICAgICAgICAgICAgICBiZyA9IHRiW3RpICsgMV0sXG4gICAgICAgICAgICAgICAgICAgICAgICBiYiA9IHRiW3RpICsgMl07XG4gICAgICAgICAgICAgICAgICAgIGlmIChmYSA9PSBiYSAmJiBmciA9PSBiciAmJiBmZyA9PSBiZyAmJiBmYiA9PSBiYikgY29udGludWU7XG4gICAgICAgICAgICAgICAgICAgIC8vaWYoZmEhPTI1NSAmJiBiYSE9MCkgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICBpZiAoZmEgPCAyMjAgJiYgYmEgPiAyMCkgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgVVBORy5lbmNvZGUgPSBmdW5jdGlvbiAoYnVmcywgdywgaCwgcHMsIGRlbHMsIGZvcmJpZFBsdGUpIHtcbiAgICAgICAgaWYgKHBzID09IG51bGwpIHBzID0gMDtcbiAgICAgICAgaWYgKGZvcmJpZFBsdGUgPT0gbnVsbCkgZm9yYmlkUGx0ZSA9IGZhbHNlO1xuXG4gICAgICAgIHZhciBuaW1nID0gVVBORy5lbmNvZGUuY29tcHJlc3MoYnVmcywgdywgaCwgcHMsIGZhbHNlLCBmb3JiaWRQbHRlKTtcbiAgICAgICAgVVBORy5lbmNvZGUuY29tcHJlc3NQTkcobmltZywgLTEpO1xuXG4gICAgICAgIHJldHVybiBVUE5HLmVuY29kZS5fbWFpbihuaW1nLCB3LCBoLCBkZWxzKTtcbiAgICB9XG5cbiAgICBVUE5HLmVuY29kZUxMID0gZnVuY3Rpb24gKGJ1ZnMsIHcsIGgsIGNjLCBhYywgZGVwdGgsIGRlbHMpIHtcbiAgICAgICAgdmFyIG5pbWcgPSB7XG4gICAgICAgICAgICBjdHlwZTogMCArIChjYyA9PSAxID8gMCA6IDIpICsgKGFjID09IDAgPyAwIDogNCksXG4gICAgICAgICAgICBkZXB0aDogZGVwdGgsXG4gICAgICAgICAgICBmcmFtZXM6IFtdXG4gICAgICAgIH07XG5cbiAgICAgICAgdmFyIGJpcHAgPSAoY2MgKyBhYykgKiBkZXB0aCxcbiAgICAgICAgICAgIGJpcGwgPSBiaXBwICogdztcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBidWZzLmxlbmd0aDsgaSsrKSBuaW1nLmZyYW1lcy5wdXNoKHtcbiAgICAgICAgICAgIHJlY3Q6IHtcbiAgICAgICAgICAgICAgICB4OiAwLFxuICAgICAgICAgICAgICAgIHk6IDAsXG4gICAgICAgICAgICAgICAgd2lkdGg6IHcsXG4gICAgICAgICAgICAgICAgaGVpZ2h0OiBoXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgaW1nOiBuZXcgVWludDhBcnJheShidWZzW2ldKSxcbiAgICAgICAgICAgIGJsZW5kOiAwLFxuICAgICAgICAgICAgZGlzcG9zZTogMSxcbiAgICAgICAgICAgIGJwcDogTWF0aC5jZWlsKGJpcHAgLyA4KSxcbiAgICAgICAgICAgIGJwbDogTWF0aC5jZWlsKGJpcGwgLyA4KVxuICAgICAgICB9KTtcblxuICAgICAgICBVUE5HLmVuY29kZS5jb21wcmVzc1BORyhuaW1nLCA0KTtcblxuICAgICAgICByZXR1cm4gVVBORy5lbmNvZGUuX21haW4obmltZywgdywgaCwgZGVscyk7XG4gICAgfVxuXG4gICAgVVBORy5lbmNvZGUuX21haW4gPSBmdW5jdGlvbiAobmltZywgdywgaCwgZGVscykge1xuICAgICAgICB2YXIgY3JjID0gVVBORy5jcmMuY3JjLFxuICAgICAgICAgICAgd1VpID0gVVBORy5fYmluLndyaXRlVWludCxcbiAgICAgICAgICAgIHdVcyA9IFVQTkcuX2Jpbi53cml0ZVVzaG9ydCxcbiAgICAgICAgICAgIHdBcyA9IFVQTkcuX2Jpbi53cml0ZUFTQ0lJO1xuICAgICAgICB2YXIgb2Zmc2V0ID0gOCxcbiAgICAgICAgICAgIGFuaW0gPSBuaW1nLmZyYW1lcy5sZW5ndGggPiAxLFxuICAgICAgICAgICAgcGx0QWxwaGEgPSBmYWxzZTtcblxuICAgICAgICB2YXIgbGVuZyA9IDggKyAoMTYgKyA1ICsgNCkgKyAoOSArIDQpICsgKGFuaW0gPyAyMCA6IDApO1xuICAgICAgICBpZiAobmltZy5jdHlwZSA9PSAzKSB7XG4gICAgICAgICAgICB2YXIgZGwgPSBuaW1nLnBsdGUubGVuZ3RoO1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBkbDsgaSsrKVxuICAgICAgICAgICAgICAgIGlmICgobmltZy5wbHRlW2ldID4+PiAyNCkgIT0gMjU1KSBwbHRBbHBoYSA9IHRydWU7XG4gICAgICAgICAgICBsZW5nICs9ICg4ICsgZGwgKiAzICsgNCkgKyAocGx0QWxwaGEgPyAoOCArIGRsICogMSArIDQpIDogMCk7XG4gICAgICAgIH1cbiAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBuaW1nLmZyYW1lcy5sZW5ndGg7IGorKykge1xuICAgICAgICAgICAgdmFyIGZyID0gbmltZy5mcmFtZXNbal07XG4gICAgICAgICAgICBpZiAoYW5pbSkgbGVuZyArPSAzODtcbiAgICAgICAgICAgIGxlbmcgKz0gZnIuY2ltZy5sZW5ndGggKyAxMjtcbiAgICAgICAgICAgIGlmIChqICE9IDApIGxlbmcgKz0gNDtcbiAgICAgICAgfVxuICAgICAgICBsZW5nICs9IDEyO1xuXG4gICAgICAgIHZhciBkYXRhID0gbmV3IFVpbnQ4QXJyYXkobGVuZyk7XG4gICAgICAgIHZhciB3ciA9IFsweDg5LCAweDUwLCAweDRlLCAweDQ3LCAweDBkLCAweDBhLCAweDFhLCAweDBhXTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCA4OyBpKyspIGRhdGFbaV0gPSB3cltpXTtcblxuICAgICAgICB3VWkoZGF0YSwgb2Zmc2V0LCAxMyk7XG4gICAgICAgIG9mZnNldCArPSA0O1xuICAgICAgICB3QXMoZGF0YSwgb2Zmc2V0LCBcIklIRFJcIik7XG4gICAgICAgIG9mZnNldCArPSA0O1xuICAgICAgICB3VWkoZGF0YSwgb2Zmc2V0LCB3KTtcbiAgICAgICAgb2Zmc2V0ICs9IDQ7XG4gICAgICAgIHdVaShkYXRhLCBvZmZzZXQsIGgpO1xuICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgZGF0YVtvZmZzZXRdID0gbmltZy5kZXB0aDtcbiAgICAgICAgb2Zmc2V0Kys7IC8vIGRlcHRoXG4gICAgICAgIGRhdGFbb2Zmc2V0XSA9IG5pbWcuY3R5cGU7XG4gICAgICAgIG9mZnNldCsrOyAvLyBjdHlwZVxuICAgICAgICBkYXRhW29mZnNldF0gPSAwO1xuICAgICAgICBvZmZzZXQrKzsgLy8gY29tcHJlc3NcbiAgICAgICAgZGF0YVtvZmZzZXRdID0gMDtcbiAgICAgICAgb2Zmc2V0Kys7IC8vIGZpbHRlclxuICAgICAgICBkYXRhW29mZnNldF0gPSAwO1xuICAgICAgICBvZmZzZXQrKzsgLy8gaW50ZXJsYWNlXG4gICAgICAgIHdVaShkYXRhLCBvZmZzZXQsIGNyYyhkYXRhLCBvZmZzZXQgLSAxNywgMTcpKTtcbiAgICAgICAgb2Zmc2V0ICs9IDQ7IC8vIGNyY1xuICAgICAgICAvLyA5IGJ5dGVzIHRvIHNheSwgdGhhdCBpdCBpcyBzUkdCXG4gICAgICAgIHdVaShkYXRhLCBvZmZzZXQsIDEpO1xuICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgd0FzKGRhdGEsIG9mZnNldCwgXCJzUkdCXCIpO1xuICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgZGF0YVtvZmZzZXRdID0gMTtcbiAgICAgICAgb2Zmc2V0Kys7XG4gICAgICAgIHdVaShkYXRhLCBvZmZzZXQsIGNyYyhkYXRhLCBvZmZzZXQgLSA1LCA1KSk7XG4gICAgICAgIG9mZnNldCArPSA0OyAvLyBjcmNcbiAgICAgICAgaWYgKGFuaW0pIHtcbiAgICAgICAgICAgIHdVaShkYXRhLCBvZmZzZXQsIDgpO1xuICAgICAgICAgICAgb2Zmc2V0ICs9IDQ7XG4gICAgICAgICAgICB3QXMoZGF0YSwgb2Zmc2V0LCBcImFjVExcIik7XG4gICAgICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgICAgIHdVaShkYXRhLCBvZmZzZXQsIG5pbWcuZnJhbWVzLmxlbmd0aCk7XG4gICAgICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgICAgIHdVaShkYXRhLCBvZmZzZXQsIDApO1xuICAgICAgICAgICAgb2Zmc2V0ICs9IDQ7XG4gICAgICAgICAgICB3VWkoZGF0YSwgb2Zmc2V0LCBjcmMoZGF0YSwgb2Zmc2V0IC0gMTIsIDEyKSk7XG4gICAgICAgICAgICBvZmZzZXQgKz0gNDsgLy8gY3JjXG4gICAgICAgIH1cblxuICAgICAgICBpZiAobmltZy5jdHlwZSA9PSAzKSB7XG4gICAgICAgICAgICB2YXIgZGwgPSBuaW1nLnBsdGUubGVuZ3RoO1xuICAgICAgICAgICAgd1VpKGRhdGEsIG9mZnNldCwgZGwgKiAzKTtcbiAgICAgICAgICAgIG9mZnNldCArPSA0O1xuICAgICAgICAgICAgd0FzKGRhdGEsIG9mZnNldCwgXCJQTFRFXCIpO1xuICAgICAgICAgICAgb2Zmc2V0ICs9IDQ7XG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGRsOyBpKyspIHtcbiAgICAgICAgICAgICAgICB2YXIgdGkgPSBpICogMyxcbiAgICAgICAgICAgICAgICAgICAgYyA9IG5pbWcucGx0ZVtpXSxcbiAgICAgICAgICAgICAgICAgICAgciA9IChjKSAmIDI1NSxcbiAgICAgICAgICAgICAgICAgICAgZyA9IChjID4+PiA4KSAmIDI1NSxcbiAgICAgICAgICAgICAgICAgICAgYiA9IChjID4+PiAxNikgJiAyNTU7XG4gICAgICAgICAgICAgICAgZGF0YVtvZmZzZXQgKyB0aSArIDBdID0gcjtcbiAgICAgICAgICAgICAgICBkYXRhW29mZnNldCArIHRpICsgMV0gPSBnO1xuICAgICAgICAgICAgICAgIGRhdGFbb2Zmc2V0ICsgdGkgKyAyXSA9IGI7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBvZmZzZXQgKz0gZGwgKiAzO1xuICAgICAgICAgICAgd1VpKGRhdGEsIG9mZnNldCwgY3JjKGRhdGEsIG9mZnNldCAtIGRsICogMyAtIDQsIGRsICogMyArIDQpKTtcbiAgICAgICAgICAgIG9mZnNldCArPSA0OyAvLyBjcmNcbiAgICAgICAgICAgIGlmIChwbHRBbHBoYSkge1xuICAgICAgICAgICAgICAgIHdVaShkYXRhLCBvZmZzZXQsIGRsKTtcbiAgICAgICAgICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgICAgICAgICB3QXMoZGF0YSwgb2Zmc2V0LCBcInRSTlNcIik7XG4gICAgICAgICAgICAgICAgb2Zmc2V0ICs9IDQ7XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBkbDsgaSsrKSBkYXRhW29mZnNldCArIGldID0gKG5pbWcucGx0ZVtpXSA+Pj4gMjQpICYgMjU1O1xuICAgICAgICAgICAgICAgIG9mZnNldCArPSBkbDtcbiAgICAgICAgICAgICAgICB3VWkoZGF0YSwgb2Zmc2V0LCBjcmMoZGF0YSwgb2Zmc2V0IC0gZGwgLSA0LCBkbCArIDQpKTtcbiAgICAgICAgICAgICAgICBvZmZzZXQgKz0gNDsgLy8gY3JjXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgZmkgPSAwO1xuICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IG5pbWcuZnJhbWVzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgICB2YXIgZnIgPSBuaW1nLmZyYW1lc1tqXTtcbiAgICAgICAgICAgIGlmIChhbmltKSB7XG4gICAgICAgICAgICAgICAgd1VpKGRhdGEsIG9mZnNldCwgMjYpO1xuICAgICAgICAgICAgICAgIG9mZnNldCArPSA0O1xuICAgICAgICAgICAgICAgIHdBcyhkYXRhLCBvZmZzZXQsIFwiZmNUTFwiKTtcbiAgICAgICAgICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgICAgICAgICB3VWkoZGF0YSwgb2Zmc2V0LCBmaSsrKTtcbiAgICAgICAgICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgICAgICAgICB3VWkoZGF0YSwgb2Zmc2V0LCBmci5yZWN0LndpZHRoKTtcbiAgICAgICAgICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgICAgICAgICB3VWkoZGF0YSwgb2Zmc2V0LCBmci5yZWN0LmhlaWdodCk7XG4gICAgICAgICAgICAgICAgb2Zmc2V0ICs9IDQ7XG4gICAgICAgICAgICAgICAgd1VpKGRhdGEsIG9mZnNldCwgZnIucmVjdC54KTtcbiAgICAgICAgICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgICAgICAgICB3VWkoZGF0YSwgb2Zmc2V0LCBmci5yZWN0LnkpO1xuICAgICAgICAgICAgICAgIG9mZnNldCArPSA0O1xuICAgICAgICAgICAgICAgIHdVcyhkYXRhLCBvZmZzZXQsIGRlbHNbal0pO1xuICAgICAgICAgICAgICAgIG9mZnNldCArPSAyO1xuICAgICAgICAgICAgICAgIHdVcyhkYXRhLCBvZmZzZXQsIDEwMDApO1xuICAgICAgICAgICAgICAgIG9mZnNldCArPSAyO1xuICAgICAgICAgICAgICAgIGRhdGFbb2Zmc2V0XSA9IGZyLmRpc3Bvc2U7XG4gICAgICAgICAgICAgICAgb2Zmc2V0Kys7IC8vIGRpc3Bvc2VcbiAgICAgICAgICAgICAgICBkYXRhW29mZnNldF0gPSBmci5ibGVuZDtcbiAgICAgICAgICAgICAgICBvZmZzZXQrKzsgLy8gYmxlbmRcbiAgICAgICAgICAgICAgICB3VWkoZGF0YSwgb2Zmc2V0LCBjcmMoZGF0YSwgb2Zmc2V0IC0gMzAsIDMwKSk7XG4gICAgICAgICAgICAgICAgb2Zmc2V0ICs9IDQ7IC8vIGNyY1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgaW1nZCA9IGZyLmNpbWcsXG4gICAgICAgICAgICAgICAgZGwgPSBpbWdkLmxlbmd0aDtcbiAgICAgICAgICAgIHdVaShkYXRhLCBvZmZzZXQsIGRsICsgKGogPT0gMCA/IDAgOiA0KSk7XG4gICAgICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgICAgIHZhciBpb2ZmID0gb2Zmc2V0O1xuICAgICAgICAgICAgd0FzKGRhdGEsIG9mZnNldCwgKGogPT0gMCkgPyBcIklEQVRcIiA6IFwiZmRBVFwiKTtcbiAgICAgICAgICAgIG9mZnNldCArPSA0O1xuICAgICAgICAgICAgaWYgKGogIT0gMCkge1xuICAgICAgICAgICAgICAgIHdVaShkYXRhLCBvZmZzZXQsIGZpKyspO1xuICAgICAgICAgICAgICAgIG9mZnNldCArPSA0O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBkbDsgaSsrKSBkYXRhW29mZnNldCArIGldID0gaW1nZFtpXTtcbiAgICAgICAgICAgIG9mZnNldCArPSBkbDtcbiAgICAgICAgICAgIHdVaShkYXRhLCBvZmZzZXQsIGNyYyhkYXRhLCBpb2ZmLCBvZmZzZXQgLSBpb2ZmKSk7XG4gICAgICAgICAgICBvZmZzZXQgKz0gNDsgLy8gY3JjXG4gICAgICAgIH1cblxuICAgICAgICB3VWkoZGF0YSwgb2Zmc2V0LCAwKTtcbiAgICAgICAgb2Zmc2V0ICs9IDQ7XG4gICAgICAgIHdBcyhkYXRhLCBvZmZzZXQsIFwiSUVORFwiKTtcbiAgICAgICAgb2Zmc2V0ICs9IDQ7XG4gICAgICAgIHdVaShkYXRhLCBvZmZzZXQsIGNyYyhkYXRhLCBvZmZzZXQgLSA0LCA0KSk7XG4gICAgICAgIG9mZnNldCArPSA0OyAvLyBjcmNcbiAgICAgICAgcmV0dXJuIGRhdGEuYnVmZmVyO1xuICAgIH1cblxuICAgIFVQTkcuZW5jb2RlLmNvbXByZXNzUE5HID0gZnVuY3Rpb24gKG91dCwgZmlsdGVyKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgb3V0LmZyYW1lcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGZybSA9IG91dC5mcmFtZXNbaV0sXG4gICAgICAgICAgICAgICAgbncgPSBmcm0ucmVjdC53aWR0aCxcbiAgICAgICAgICAgICAgICBuaCA9IGZybS5yZWN0LmhlaWdodDtcbiAgICAgICAgICAgIHZhciBmZGF0YSA9IG5ldyBVaW50OEFycmF5KG5oICogZnJtLmJwbCArIG5oKTtcbiAgICAgICAgICAgIGZybS5jaW1nID0gVVBORy5lbmNvZGUuX2ZpbHRlclplcm8oZnJtLmltZywgbmgsIGZybS5icHAsIGZybS5icGwsIGZkYXRhLCBmaWx0ZXIpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgVVBORy5lbmNvZGUuY29tcHJlc3MgPSBmdW5jdGlvbiAoYnVmcywgdywgaCwgcHMsIGZvckdJRiwgZm9yYmlkUGx0ZSkge1xuICAgICAgICAvL3ZhciB0aW1lID0gRGF0ZS5ub3coKTtcbiAgICAgICAgaWYgKGZvcmJpZFBsdGUgPT0gbnVsbCkgZm9yYmlkUGx0ZSA9IGZhbHNlO1xuXG4gICAgICAgIHZhciBjdHlwZSA9IDYsXG4gICAgICAgICAgICBkZXB0aCA9IDgsXG4gICAgICAgICAgICBhbHBoYUFuZCA9IDI1NVxuXG4gICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgYnVmcy5sZW5ndGg7IGorKykgeyAvLyB3aGVuIG5vdCBxdWFudGl6ZWQsIG90aGVyIGZyYW1lcyBjYW4gY29udGFpbiBjb2xvcnMsIHRoYXQgYXJlIG5vdCBpbiBhbiBpbml0aWFsIGZyYW1lXG4gICAgICAgICAgICB2YXIgaW1nID0gbmV3IFVpbnQ4QXJyYXkoYnVmc1tqXSksXG4gICAgICAgICAgICAgICAgaWxlbiA9IGltZy5sZW5ndGg7XG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGlsZW47IGkgKz0gNCkgYWxwaGFBbmQgJj0gaW1nW2kgKyAzXTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgZ290QWxwaGEgPSAoYWxwaGFBbmQgIT0gMjU1KTtcblxuICAgICAgICAvL2NvbnNvbGUubG9nKFwiYWxwaGEgY2hlY2tcIiwgRGF0ZS5ub3coKS10aW1lKTsgIHRpbWUgPSBEYXRlLm5vdygpO1xuICAgICAgICB2YXIgYnJ1dGUgPSBnb3RBbHBoYSAmJiBmb3JHSUY7IC8vIGJydXRlIDogZnJhbWVzIGNhbiBvbmx5IGJlIGNvcGllZCwgbm90IFwiYmxlbmRlZFwiXG4gICAgICAgIHZhciBmcm1zID0gVVBORy5lbmNvZGUuZnJhbWl6ZShidWZzLCB3LCBoLCBmb3JHSUYsIGJydXRlKTtcbiAgICAgICAgLy9jb25zb2xlLmxvZyhcImZyYW1pemVcIiwgRGF0ZS5ub3coKS10aW1lKTsgIHRpbWUgPSBEYXRlLm5vdygpO1xuICAgICAgICB2YXIgY21hcCA9IHt9LFxuICAgICAgICAgICAgcGx0ZSA9IFtdLFxuICAgICAgICAgICAgaW5kcyA9IFtdO1xuXG4gICAgICAgIGlmIChwcyAhPSAwKSB7XG4gICAgICAgICAgICB2YXIgbmJ1ZnMgPSBbXTtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZnJtcy5sZW5ndGg7IGkrKykgbmJ1ZnMucHVzaChmcm1zW2ldLmltZy5idWZmZXIpO1xuXG4gICAgICAgICAgICB2YXIgYWJ1ZiA9IFVQTkcuZW5jb2RlLmNvbmNhdFJHQkEobmJ1ZnMsIGZvckdJRiksXG4gICAgICAgICAgICAgICAgcXJlcyA9IFVQTkcucXVhbnRpemUoYWJ1ZiwgcHMpO1xuICAgICAgICAgICAgdmFyIGNvZiA9IDAsXG4gICAgICAgICAgICAgICAgYmIgPSBuZXcgVWludDhBcnJheShxcmVzLmFidWYpO1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBmcm1zLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgdmFyIHRpID0gZnJtc1tpXS5pbWcsXG4gICAgICAgICAgICAgICAgICAgIGJsbiA9IHRpLmxlbmd0aDtcbiAgICAgICAgICAgICAgICBpbmRzLnB1c2gobmV3IFVpbnQ4QXJyYXkocXJlcy5pbmRzLmJ1ZmZlciwgY29mID4+IDIsIGJsbiA+PiAyKSk7XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBibG47IGogKz0gNCkge1xuICAgICAgICAgICAgICAgICAgICB0aVtqXSA9IGJiW2NvZiArIGpdO1xuICAgICAgICAgICAgICAgICAgICB0aVtqICsgMV0gPSBiYltjb2YgKyBqICsgMV07XG4gICAgICAgICAgICAgICAgICAgIHRpW2ogKyAyXSA9IGJiW2NvZiArIGogKyAyXTtcbiAgICAgICAgICAgICAgICAgICAgdGlbaiArIDNdID0gYmJbY29mICsgaiArIDNdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjb2YgKz0gYmxuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHFyZXMucGx0ZS5sZW5ndGg7IGkrKykgcGx0ZS5wdXNoKHFyZXMucGx0ZVtpXS5lc3QucmdiYSk7XG4gICAgICAgICAgICAvL2NvbnNvbGUubG9nKFwicXVhbnRpemVcIiwgRGF0ZS5ub3coKS10aW1lKTsgIHRpbWUgPSBEYXRlLm5vdygpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gd2hhdCBpZiBwcz09MCwgYnV0IHRoZXJlIGFyZSA8PTI1NiBjb2xvcnM/ICB3ZSBzdGlsbCBuZWVkIHRvIGRldGVjdCwgaWYgdGhlIHBhbGV0dGUgY291bGQgYmUgdXNlZFxuICAgICAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBmcm1zLmxlbmd0aDsgaisrKSB7IC8vIHdoZW4gbm90IHF1YW50aXplZCwgb3RoZXIgZnJhbWVzIGNhbiBjb250YWluIGNvbG9ycywgdGhhdCBhcmUgbm90IGluIGFuIGluaXRpYWwgZnJhbWVcbiAgICAgICAgICAgICAgICB2YXIgZnJtID0gZnJtc1tqXSxcbiAgICAgICAgICAgICAgICAgICAgaW1nMzIgPSBuZXcgVWludDMyQXJyYXkoZnJtLmltZy5idWZmZXIpLFxuICAgICAgICAgICAgICAgICAgICBudyA9IGZybS5yZWN0LndpZHRoLFxuICAgICAgICAgICAgICAgICAgICBpbGVuID0gaW1nMzIubGVuZ3RoO1xuICAgICAgICAgICAgICAgIHZhciBpbmQgPSBuZXcgVWludDhBcnJheShpbGVuKTtcbiAgICAgICAgICAgICAgICBpbmRzLnB1c2goaW5kKTtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGlsZW47IGkrKykge1xuICAgICAgICAgICAgICAgICAgICB2YXIgYyA9IGltZzMyW2ldO1xuICAgICAgICAgICAgICAgICAgICBpZiAoaSAhPSAwICYmIGMgPT0gaW1nMzJbaSAtIDFdKSBpbmRbaV0gPSBpbmRbaSAtIDFdO1xuICAgICAgICAgICAgICAgICAgICBlbHNlIGlmIChpID4gbncgJiYgYyA9PSBpbWczMltpIC0gbnddKSBpbmRbaV0gPSBpbmRbaSAtIG53XTtcbiAgICAgICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgY21jID0gY21hcFtjXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjbWMgPT0gbnVsbCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNtYXBbY10gPSBjbWMgPSBwbHRlLmxlbmd0aDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwbHRlLnB1c2goYyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBsdGUubGVuZ3RoID49IDMwMCkgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBpbmRbaV0gPSBjbWM7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvL2NvbnNvbGUubG9nKFwibWFrZSBwYWxldHRlXCIsIERhdGUubm93KCktdGltZSk7ICB0aW1lID0gRGF0ZS5ub3coKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBjYyA9IHBsdGUubGVuZ3RoOyAvL2NvbnNvbGUubG9nKFwiY29sb3JzOlwiLGNjKTtcbiAgICAgICAgaWYgKGNjIDw9IDI1NiAmJiBmb3JiaWRQbHRlID09IGZhbHNlKSB7XG4gICAgICAgICAgICBpZiAoY2MgPD0gMikgZGVwdGggPSAxO1xuICAgICAgICAgICAgZWxzZSBpZiAoY2MgPD0gNCkgZGVwdGggPSAyO1xuICAgICAgICAgICAgZWxzZSBpZiAoY2MgPD0gMTYpIGRlcHRoID0gNDtcbiAgICAgICAgICAgIGVsc2UgZGVwdGggPSA4O1xuICAgICAgICAgICAgaWYgKGZvckdJRikgZGVwdGggPSA4O1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBmcm1zLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgICB2YXIgZnJtID0gZnJtc1tqXSxcbiAgICAgICAgICAgICAgICBueCA9IGZybS5yZWN0LngsXG4gICAgICAgICAgICAgICAgbnkgPSBmcm0ucmVjdC55LFxuICAgICAgICAgICAgICAgIG53ID0gZnJtLnJlY3Qud2lkdGgsXG4gICAgICAgICAgICAgICAgbmggPSBmcm0ucmVjdC5oZWlnaHQ7XG4gICAgICAgICAgICB2YXIgY2ltZyA9IGZybS5pbWcsXG4gICAgICAgICAgICAgICAgY2ltZzMyID0gbmV3IFVpbnQzMkFycmF5KGNpbWcuYnVmZmVyKTtcbiAgICAgICAgICAgIHZhciBicGwgPSA0ICogbncsXG4gICAgICAgICAgICAgICAgYnBwID0gNDtcbiAgICAgICAgICAgIGlmIChjYyA8PSAyNTYgJiYgZm9yYmlkUGx0ZSA9PSBmYWxzZSkge1xuICAgICAgICAgICAgICAgIGJwbCA9IE1hdGguY2VpbChkZXB0aCAqIG53IC8gOCk7XG4gICAgICAgICAgICAgICAgdmFyIG5pbWcgPSBuZXcgVWludDhBcnJheShicGwgKiBuaCk7XG4gICAgICAgICAgICAgICAgdmFyIGluaiA9IGluZHNbal07XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgeSA9IDA7IHkgPCBuaDsgeSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBpID0geSAqIGJwbCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGlpID0geSAqIG53O1xuICAgICAgICAgICAgICAgICAgICBpZiAoZGVwdGggPT0gOClcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAodmFyIHggPSAwOyB4IDwgbnc7IHgrKykgbmltZ1tpICsgKHgpXSA9IChpbmpbaWkgKyB4XSk7XG4gICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKGRlcHRoID09IDQpXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciB4ID0gMDsgeCA8IG53OyB4KyspIG5pbWdbaSArICh4ID4+IDEpXSB8PSAoaW5qW2lpICsgeF0gPDwgKDQgLSAoeCAmIDEpICogNCkpO1xuICAgICAgICAgICAgICAgICAgICBlbHNlIGlmIChkZXB0aCA9PSAyKVxuICAgICAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIgeCA9IDA7IHggPCBudzsgeCsrKSBuaW1nW2kgKyAoeCA+PiAyKV0gfD0gKGlualtpaSArIHhdIDw8ICg2IC0gKHggJiAzKSAqIDIpKTtcbiAgICAgICAgICAgICAgICAgICAgZWxzZSBpZiAoZGVwdGggPT0gMSlcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAodmFyIHggPSAwOyB4IDwgbnc7IHgrKykgbmltZ1tpICsgKHggPj4gMyldIHw9IChpbmpbaWkgKyB4XSA8PCAoNyAtICh4ICYgNykgKiAxKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNpbWcgPSBuaW1nO1xuICAgICAgICAgICAgICAgIGN0eXBlID0gMztcbiAgICAgICAgICAgICAgICBicHAgPSAxO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChnb3RBbHBoYSA9PSBmYWxzZSAmJiBmcm1zLmxlbmd0aCA9PSAxKSB7IC8vIHNvbWUgbmV4dCBcInJlZHVjZWRcIiBmcmFtZXMgbWF5IGNvbnRhaW4gYWxwaGEgZm9yIGJsZW5kaW5nXG4gICAgICAgICAgICAgICAgdmFyIG5pbWcgPSBuZXcgVWludDhBcnJheShudyAqIG5oICogMyksXG4gICAgICAgICAgICAgICAgICAgIGFyZWEgPSBudyAqIG5oO1xuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJlYTsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciB0aSA9IGkgKiAzLFxuICAgICAgICAgICAgICAgICAgICAgICAgcWkgPSBpICogNDtcbiAgICAgICAgICAgICAgICAgICAgbmltZ1t0aV0gPSBjaW1nW3FpXTtcbiAgICAgICAgICAgICAgICAgICAgbmltZ1t0aSArIDFdID0gY2ltZ1txaSArIDFdO1xuICAgICAgICAgICAgICAgICAgICBuaW1nW3RpICsgMl0gPSBjaW1nW3FpICsgMl07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNpbWcgPSBuaW1nO1xuICAgICAgICAgICAgICAgIGN0eXBlID0gMjtcbiAgICAgICAgICAgICAgICBicHAgPSAzO1xuICAgICAgICAgICAgICAgIGJwbCA9IDMgKiBudztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGZybS5pbWcgPSBjaW1nO1xuICAgICAgICAgICAgZnJtLmJwbCA9IGJwbDtcbiAgICAgICAgICAgIGZybS5icHAgPSBicHA7XG4gICAgICAgIH1cbiAgICAgICAgLy9jb25zb2xlLmxvZyhcImNvbG9ycyA9PiBwYWxldHRlIGluZGljZXNcIiwgRGF0ZS5ub3coKS10aW1lKTsgIHRpbWUgPSBEYXRlLm5vdygpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY3R5cGU6IGN0eXBlLFxuICAgICAgICAgICAgZGVwdGg6IGRlcHRoLFxuICAgICAgICAgICAgcGx0ZTogcGx0ZSxcbiAgICAgICAgICAgIGZyYW1lczogZnJtc1xuICAgICAgICB9O1xuICAgIH1cbiAgICBVUE5HLmVuY29kZS5mcmFtaXplID0gZnVuY3Rpb24gKGJ1ZnMsIHcsIGgsIGZvckdJRiwgYnJ1dGUpIHtcbiAgICAgICAgdmFyIGZybXMgPSBbXTtcbiAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBidWZzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgICB2YXIgY2ltZyA9IG5ldyBVaW50OEFycmF5KGJ1ZnNbal0pLFxuICAgICAgICAgICAgICAgIGNpbWczMiA9IG5ldyBVaW50MzJBcnJheShjaW1nLmJ1ZmZlcik7XG5cbiAgICAgICAgICAgIHZhciBueCA9IDAsXG4gICAgICAgICAgICAgICAgbnkgPSAwLFxuICAgICAgICAgICAgICAgIG53ID0gdyxcbiAgICAgICAgICAgICAgICBuaCA9IGgsXG4gICAgICAgICAgICAgICAgYmxlbmQgPSAwO1xuICAgICAgICAgICAgaWYgKGogIT0gMCAmJiAhYnJ1dGUpIHtcbiAgICAgICAgICAgICAgICB2YXIgdGxpbSA9IChmb3JHSUYgfHwgaiA9PSAxIHx8IGZybXNbZnJtcy5sZW5ndGggLSAyXS5kaXNwb3NlID09IDIpID8gMSA6IDIsXG4gICAgICAgICAgICAgICAgICAgIHRzdHAgPSAwLFxuICAgICAgICAgICAgICAgICAgICB0YXJlYSA9IDFlOTtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBpdCA9IDA7IGl0IDwgdGxpbTsgaXQrKykge1xuICAgICAgICAgICAgICAgICAgICB2YXIgcGltZyA9IG5ldyBVaW50OEFycmF5KGJ1ZnNbaiAtIDEgLSBpdF0pLFxuICAgICAgICAgICAgICAgICAgICAgICAgcDMyID0gbmV3IFVpbnQzMkFycmF5KGJ1ZnNbaiAtIDEgLSBpdF0pO1xuICAgICAgICAgICAgICAgICAgICB2YXIgbWl4ID0gdyxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1peSA9IGgsXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXggPSAtMSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1heSA9IC0xO1xuICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciB5ID0gMDsgeSA8IGg7IHkrKylcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAodmFyIHggPSAwOyB4IDwgdzsgeCsrKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGkgPSB5ICogdyArIHg7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGNpbWczMltpXSAhPSBwMzJbaV0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHggPCBtaXgpIG1peCA9IHg7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh4ID4gbWF4KSBtYXggPSB4O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoeSA8IG1peSkgbWl5ID0geTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHkgPiBtYXkpIG1heSA9IHk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB2YXIgc2FyZWEgPSAobWF4ID09IC0xKSA/IDEgOiAobWF4IC0gbWl4ICsgMSkgKiAobWF5IC0gbWl5ICsgMSk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChzYXJlYSA8IHRhcmVhKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0YXJlYSA9IHNhcmVhO1xuICAgICAgICAgICAgICAgICAgICAgICAgdHN0cCA9IGl0O1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKG1heCA9PSAtMSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG54ID0gbnkgPSAwO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG53ID0gbmggPSAxO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBueCA9IG1peDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBueSA9IG1peTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBudyA9IG1heCAtIG1peCArIDE7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbmggPSBtYXkgLSBtaXkgKyAxO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdmFyIHBpbWcgPSBuZXcgVWludDhBcnJheShidWZzW2ogLSAxIC0gdHN0cF0pO1xuICAgICAgICAgICAgICAgIGlmICh0c3RwID09IDEpIGZybXNbZnJtcy5sZW5ndGggLSAxXS5kaXNwb3NlID0gMjtcblxuICAgICAgICAgICAgICAgIHZhciBuaW1nID0gbmV3IFVpbnQ4QXJyYXkobncgKiBuaCAqIDQpLFxuICAgICAgICAgICAgICAgICAgICBuaW1nMzIgPSBuZXcgVWludDMyQXJyYXkobmltZy5idWZmZXIpO1xuICAgICAgICAgICAgICAgIFVQTkcuX2NvcHlUaWxlKHBpbWcsIHcsIGgsIG5pbWcsIG53LCBuaCwgLW54LCAtbnksIDApO1xuICAgICAgICAgICAgICAgIGlmIChVUE5HLl9jb3B5VGlsZShjaW1nLCB3LCBoLCBuaW1nLCBudywgbmgsIC1ueCwgLW55LCAzKSkge1xuICAgICAgICAgICAgICAgICAgICBVUE5HLl9jb3B5VGlsZShjaW1nLCB3LCBoLCBuaW1nLCBudywgbmgsIC1ueCwgLW55LCAyKTtcbiAgICAgICAgICAgICAgICAgICAgYmxlbmQgPSAxO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIFVQTkcuX2NvcHlUaWxlKGNpbWcsIHcsIGgsIG5pbWcsIG53LCBuaCwgLW54LCAtbnksIDApO1xuICAgICAgICAgICAgICAgICAgICBibGVuZCA9IDA7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNpbWcgPSBuaW1nO1xuICAgICAgICAgICAgfSBlbHNlIGNpbWcgPSBjaW1nLnNsaWNlKDApOyAvLyBpbWcgbWF5IGJlIHJld3JpdGVkIGZ1cnRoZXIgLi4uIGRvbid0IHJld3JpdGUgaW5wdXRcbiAgICAgICAgICAgIGZybXMucHVzaCh7XG4gICAgICAgICAgICAgICAgcmVjdDoge1xuICAgICAgICAgICAgICAgICAgICB4OiBueCxcbiAgICAgICAgICAgICAgICAgICAgeTogbnksXG4gICAgICAgICAgICAgICAgICAgIHdpZHRoOiBudyxcbiAgICAgICAgICAgICAgICAgICAgaGVpZ2h0OiBuaFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgaW1nOiBjaW1nLFxuICAgICAgICAgICAgICAgIGJsZW5kOiBibGVuZCxcbiAgICAgICAgICAgICAgICBkaXNwb3NlOiBicnV0ZSA/IDEgOiAwXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZnJtcztcbiAgICB9XG5cbiAgICBVUE5HLmVuY29kZS5fZmlsdGVyWmVybyA9IGZ1bmN0aW9uIChpbWcsIGgsIGJwcCwgYnBsLCBkYXRhLCBmaWx0ZXIpIHtcbiAgICAgICAgaWYgKGZpbHRlciAhPSAtMSkge1xuICAgICAgICAgICAgZm9yICh2YXIgeSA9IDA7IHkgPCBoOyB5KyspIFVQTkcuZW5jb2RlLl9maWx0ZXJMaW5lKGRhdGEsIGltZywgeSwgYnBsLCBicHAsIGZpbHRlcik7XG4gICAgICAgICAgICByZXR1cm4gcGFrb1tcImRlZmxhdGVcIl0oZGF0YSk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGZscyA9IFtdO1xuICAgICAgICBmb3IgKHZhciB0ID0gMDsgdCA8IDU7IHQrKykge1xuICAgICAgICAgICAgaWYgKGggKiBicGwgPiA1MDAwMDAgJiYgKHQgPT0gMiB8fCB0ID09IDMgfHwgdCA9PSA0KSkgY29udGludWU7XG4gICAgICAgICAgICBmb3IgKHZhciB5ID0gMDsgeSA8IGg7IHkrKykgVVBORy5lbmNvZGUuX2ZpbHRlckxpbmUoZGF0YSwgaW1nLCB5LCBicGwsIGJwcCwgdCk7XG4gICAgICAgICAgICBmbHMucHVzaChwYWtvW1wiZGVmbGF0ZVwiXShkYXRhKSk7XG4gICAgICAgICAgICBpZiAoYnBwID09IDEpIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIHZhciB0aSwgdHNpemUgPSAxZTk7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZmxzLmxlbmd0aDsgaSsrKVxuICAgICAgICAgICAgaWYgKGZsc1tpXS5sZW5ndGggPCB0c2l6ZSkge1xuICAgICAgICAgICAgICAgIHRpID0gaTtcbiAgICAgICAgICAgICAgICB0c2l6ZSA9IGZsc1tpXS5sZW5ndGg7XG4gICAgICAgICAgICB9XG4gICAgICAgIHJldHVybiBmbHNbdGldO1xuICAgIH1cbiAgICBVUE5HLmVuY29kZS5fZmlsdGVyTGluZSA9IGZ1bmN0aW9uIChkYXRhLCBpbWcsIHksIGJwbCwgYnBwLCB0eXBlKSB7XG4gICAgICAgIHZhciBpID0geSAqIGJwbCxcbiAgICAgICAgICAgIGRpID0gaSArIHksXG4gICAgICAgICAgICBwYWV0aCA9IFVQTkcuZGVjb2RlLl9wYWV0aDtcbiAgICAgICAgZGF0YVtkaV0gPSB0eXBlO1xuICAgICAgICBkaSsrO1xuXG4gICAgICAgIGlmICh0eXBlID09IDApXG4gICAgICAgICAgICBmb3IgKHZhciB4ID0gMDsgeCA8IGJwbDsgeCsrKSBkYXRhW2RpICsgeF0gPSBpbWdbaSArIHhdO1xuICAgICAgICBlbHNlIGlmICh0eXBlID09IDEpIHtcbiAgICAgICAgICAgIGZvciAodmFyIHggPSAwOyB4IDwgYnBwOyB4KyspIGRhdGFbZGkgKyB4XSA9IGltZ1tpICsgeF07XG4gICAgICAgICAgICBmb3IgKHZhciB4ID0gYnBwOyB4IDwgYnBsOyB4KyspIGRhdGFbZGkgKyB4XSA9IChpbWdbaSArIHhdIC0gaW1nW2kgKyB4IC0gYnBwXSArIDI1NikgJiAyNTU7XG4gICAgICAgIH0gZWxzZSBpZiAoeSA9PSAwKSB7XG4gICAgICAgICAgICBmb3IgKHZhciB4ID0gMDsgeCA8IGJwcDsgeCsrKSBkYXRhW2RpICsgeF0gPSBpbWdbaSArIHhdO1xuXG4gICAgICAgICAgICBpZiAodHlwZSA9PSAyKVxuICAgICAgICAgICAgICAgIGZvciAodmFyIHggPSBicHA7IHggPCBicGw7IHgrKykgZGF0YVtkaSArIHhdID0gaW1nW2kgKyB4XTtcbiAgICAgICAgICAgIGlmICh0eXBlID09IDMpXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgeCA9IGJwcDsgeCA8IGJwbDsgeCsrKSBkYXRhW2RpICsgeF0gPSAoaW1nW2kgKyB4XSAtIChpbWdbaSArIHggLSBicHBdID4+IDEpICsgMjU2KSAmIDI1NTtcbiAgICAgICAgICAgIGlmICh0eXBlID09IDQpXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgeCA9IGJwcDsgeCA8IGJwbDsgeCsrKSBkYXRhW2RpICsgeF0gPSAoaW1nW2kgKyB4XSAtIHBhZXRoKGltZ1tpICsgeCAtIGJwcF0sIDAsIDApICsgMjU2KSAmIDI1NTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGlmICh0eXBlID09IDIpIHtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciB4ID0gMDsgeCA8IGJwbDsgeCsrKSBkYXRhW2RpICsgeF0gPSAoaW1nW2kgKyB4XSArIDI1NiAtIGltZ1tpICsgeCAtIGJwbF0pICYgMjU1O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHR5cGUgPT0gMykge1xuICAgICAgICAgICAgICAgIGZvciAodmFyIHggPSAwOyB4IDwgYnBwOyB4KyspIGRhdGFbZGkgKyB4XSA9IChpbWdbaSArIHhdICsgMjU2IC0gKGltZ1tpICsgeCAtIGJwbF0gPj4gMSkpICYgMjU1O1xuICAgICAgICAgICAgICAgIGZvciAodmFyIHggPSBicHA7IHggPCBicGw7IHgrKykgZGF0YVtkaSArIHhdID0gKGltZ1tpICsgeF0gKyAyNTYgLSAoKGltZ1tpICsgeCAtIGJwbF0gKyBpbWdbaSArIHggLSBicHBdKSA+PiAxKSkgJiAyNTU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodHlwZSA9PSA0KSB7XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgeCA9IDA7IHggPCBicHA7IHgrKykgZGF0YVtkaSArIHhdID0gKGltZ1tpICsgeF0gKyAyNTYgLSBwYWV0aCgwLCBpbWdbaSArIHggLSBicGxdLCAwKSkgJiAyNTU7XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgeCA9IGJwcDsgeCA8IGJwbDsgeCsrKSBkYXRhW2RpICsgeF0gPSAoaW1nW2kgKyB4XSArIDI1NiAtIHBhZXRoKGltZ1tpICsgeCAtIGJwcF0sIGltZ1tpICsgeCAtIGJwbF0sIGltZ1tpICsgeCAtIGJwcCAtIGJwbF0pKSAmIDI1NTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIFVQTkcuY3JjID0ge1xuICAgICAgICB0YWJsZTogKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciB0YWIgPSBuZXcgVWludDMyQXJyYXkoMjU2KTtcbiAgICAgICAgICAgIGZvciAodmFyIG4gPSAwOyBuIDwgMjU2OyBuKyspIHtcbiAgICAgICAgICAgICAgICB2YXIgYyA9IG47XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgayA9IDA7IGsgPCA4OyBrKyspIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGMgJiAxKSBjID0gMHhlZGI4ODMyMCBeIChjID4+PiAxKTtcbiAgICAgICAgICAgICAgICAgICAgZWxzZSBjID0gYyA+Pj4gMTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdGFiW25dID0gYztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0YWI7XG4gICAgICAgIH0pKCksXG4gICAgICAgIHVwZGF0ZTogZnVuY3Rpb24gKGMsIGJ1Ziwgb2ZmLCBsZW4pIHtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspIGMgPSBVUE5HLmNyYy50YWJsZVsoYyBeIGJ1ZltvZmYgKyBpXSkgJiAweGZmXSBeIChjID4+PiA4KTtcbiAgICAgICAgICAgIHJldHVybiBjO1xuICAgICAgICB9LFxuICAgICAgICBjcmM6IGZ1bmN0aW9uIChiLCBvLCBsKSB7XG4gICAgICAgICAgICByZXR1cm4gVVBORy5jcmMudXBkYXRlKDB4ZmZmZmZmZmYsIGIsIG8sIGwpIF4gMHhmZmZmZmZmZjtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIFVQTkcucXVhbnRpemUgPSBmdW5jdGlvbiAoYWJ1ZiwgcHMpIHtcbiAgICAgICAgdmFyIG9pbWcgPSBuZXcgVWludDhBcnJheShhYnVmKSxcbiAgICAgICAgICAgIG5pbWcgPSBvaW1nLnNsaWNlKDApLFxuICAgICAgICAgICAgbmltZzMyID0gbmV3IFVpbnQzMkFycmF5KG5pbWcuYnVmZmVyKTtcblxuICAgICAgICB2YXIgS0QgPSBVUE5HLnF1YW50aXplLmdldEtEdHJlZShuaW1nLCBwcyk7XG4gICAgICAgIHZhciByb290ID0gS0RbMF0sXG4gICAgICAgICAgICBsZWFmcyA9IEtEWzFdO1xuXG4gICAgICAgIHZhciBwbGFuZURzdCA9IFVQTkcucXVhbnRpemUucGxhbmVEc3Q7XG4gICAgICAgIHZhciBzYiA9IG9pbWcsXG4gICAgICAgICAgICB0YiA9IG5pbWczMixcbiAgICAgICAgICAgIGxlbiA9IHNiLmxlbmd0aDtcblxuICAgICAgICB2YXIgaW5kcyA9IG5ldyBVaW50OEFycmF5KG9pbWcubGVuZ3RoID4+IDIpO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSArPSA0KSB7XG4gICAgICAgICAgICB2YXIgciA9IHNiW2ldICogKDEgLyAyNTUpLFxuICAgICAgICAgICAgICAgIGcgPSBzYltpICsgMV0gKiAoMSAvIDI1NSksXG4gICAgICAgICAgICAgICAgYiA9IHNiW2kgKyAyXSAqICgxIC8gMjU1KSxcbiAgICAgICAgICAgICAgICBhID0gc2JbaSArIDNdICogKDEgLyAyNTUpO1xuXG4gICAgICAgICAgICAvLyAgZXhhY3QsIGJ1dCB0b28gc2xvdyA6KFxuICAgICAgICAgICAgdmFyIG5kID0gVVBORy5xdWFudGl6ZS5nZXROZWFyZXN0KHJvb3QsIHIsIGcsIGIsIGEpO1xuICAgICAgICAgICAgLy92YXIgbmQgPSByb290O1xuICAgICAgICAgICAgLy93aGlsZShuZC5sZWZ0KSBuZCA9IChwbGFuZURzdChuZC5lc3QscixnLGIsYSk8PTApID8gbmQubGVmdCA6IG5kLnJpZ2h0O1xuICAgICAgICAgICAgaW5kc1tpID4+IDJdID0gbmQuaW5kO1xuICAgICAgICAgICAgdGJbaSA+PiAyXSA9IG5kLmVzdC5yZ2JhO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBhYnVmOiBuaW1nLmJ1ZmZlcixcbiAgICAgICAgICAgIGluZHM6IGluZHMsXG4gICAgICAgICAgICBwbHRlOiBsZWFmc1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIFVQTkcucXVhbnRpemUuZ2V0S0R0cmVlID0gZnVuY3Rpb24gKG5pbWcsIHBzLCBlcnIpIHtcbiAgICAgICAgaWYgKGVyciA9PSBudWxsKSBlcnIgPSAwLjAwMDE7XG4gICAgICAgIHZhciBuaW1nMzIgPSBuZXcgVWludDMyQXJyYXkobmltZy5idWZmZXIpO1xuXG4gICAgICAgIHZhciByb290ID0ge1xuICAgICAgICAgICAgaTA6IDAsXG4gICAgICAgICAgICBpMTogbmltZy5sZW5ndGgsXG4gICAgICAgICAgICBic3Q6IG51bGwsXG4gICAgICAgICAgICBlc3Q6IG51bGwsXG4gICAgICAgICAgICB0ZHN0OiAwLFxuICAgICAgICAgICAgbGVmdDogbnVsbCxcbiAgICAgICAgICAgIHJpZ2h0OiBudWxsXG4gICAgICAgIH07IC8vIGJhc2ljIHN0YXRpc3RpYywgZXh0cmEgc3RhdGlzdGljXG4gICAgICAgIHJvb3QuYnN0ID0gVVBORy5xdWFudGl6ZS5zdGF0cyhuaW1nLCByb290LmkwLCByb290LmkxKTtcbiAgICAgICAgcm9vdC5lc3QgPSBVUE5HLnF1YW50aXplLmVzdGF0cyhyb290LmJzdCk7XG4gICAgICAgIHZhciBsZWFmcyA9IFtyb290XTtcblxuICAgICAgICB3aGlsZSAobGVhZnMubGVuZ3RoIDwgcHMpIHtcbiAgICAgICAgICAgIHZhciBtYXhMID0gMCxcbiAgICAgICAgICAgICAgICBtaSA9IDA7XG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlYWZzLmxlbmd0aDsgaSsrKVxuICAgICAgICAgICAgICAgIGlmIChsZWFmc1tpXS5lc3QuTCA+IG1heEwpIHtcbiAgICAgICAgICAgICAgICAgICAgbWF4TCA9IGxlYWZzW2ldLmVzdC5MO1xuICAgICAgICAgICAgICAgICAgICBtaSA9IGk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKG1heEwgPCBlcnIpIGJyZWFrO1xuICAgICAgICAgICAgdmFyIG5vZGUgPSBsZWFmc1ttaV07XG5cbiAgICAgICAgICAgIHZhciBzMCA9IFVQTkcucXVhbnRpemUuc3BsaXRQaXhlbHMobmltZywgbmltZzMyLCBub2RlLmkwLCBub2RlLmkxLCBub2RlLmVzdC5lLCBub2RlLmVzdC5lTXEyNTUpO1xuICAgICAgICAgICAgdmFyIHMwd3JvbmcgPSAobm9kZS5pMCA+PSBzMCB8fCBub2RlLmkxIDw9IHMwKTtcbiAgICAgICAgICAgIC8vY29uc29sZS5sb2cobWF4TCwgbGVhZnMubGVuZ3RoLCBtaSk7XG4gICAgICAgICAgICBpZiAoczB3cm9uZykge1xuICAgICAgICAgICAgICAgIG5vZGUuZXN0LkwgPSAwO1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgbG4gPSB7XG4gICAgICAgICAgICAgICAgaTA6IG5vZGUuaTAsXG4gICAgICAgICAgICAgICAgaTE6IHMwLFxuICAgICAgICAgICAgICAgIGJzdDogbnVsbCxcbiAgICAgICAgICAgICAgICBlc3Q6IG51bGwsXG4gICAgICAgICAgICAgICAgdGRzdDogMCxcbiAgICAgICAgICAgICAgICBsZWZ0OiBudWxsLFxuICAgICAgICAgICAgICAgIHJpZ2h0OiBudWxsXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgbG4uYnN0ID0gVVBORy5xdWFudGl6ZS5zdGF0cyhuaW1nLCBsbi5pMCwgbG4uaTEpO1xuICAgICAgICAgICAgbG4uZXN0ID0gVVBORy5xdWFudGl6ZS5lc3RhdHMobG4uYnN0KTtcbiAgICAgICAgICAgIHZhciBybiA9IHtcbiAgICAgICAgICAgICAgICBpMDogczAsXG4gICAgICAgICAgICAgICAgaTE6IG5vZGUuaTEsXG4gICAgICAgICAgICAgICAgYnN0OiBudWxsLFxuICAgICAgICAgICAgICAgIGVzdDogbnVsbCxcbiAgICAgICAgICAgICAgICB0ZHN0OiAwLFxuICAgICAgICAgICAgICAgIGxlZnQ6IG51bGwsXG4gICAgICAgICAgICAgICAgcmlnaHQ6IG51bGxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBybi5ic3QgPSB7XG4gICAgICAgICAgICAgICAgUjogW10sXG4gICAgICAgICAgICAgICAgbTogW10sXG4gICAgICAgICAgICAgICAgTjogbm9kZS5ic3QuTiAtIGxuLmJzdC5OXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCAxNjsgaSsrKSBybi5ic3QuUltpXSA9IG5vZGUuYnN0LlJbaV0gLSBsbi5ic3QuUltpXTtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgNDsgaSsrKSBybi5ic3QubVtpXSA9IG5vZGUuYnN0Lm1baV0gLSBsbi5ic3QubVtpXTtcbiAgICAgICAgICAgIHJuLmVzdCA9IFVQTkcucXVhbnRpemUuZXN0YXRzKHJuLmJzdCk7XG5cbiAgICAgICAgICAgIG5vZGUubGVmdCA9IGxuO1xuICAgICAgICAgICAgbm9kZS5yaWdodCA9IHJuO1xuICAgICAgICAgICAgbGVhZnNbbWldID0gbG47XG4gICAgICAgICAgICBsZWFmcy5wdXNoKHJuKTtcbiAgICAgICAgfVxuICAgICAgICBsZWFmcy5zb3J0KGZ1bmN0aW9uIChhLCBiKSB7XG4gICAgICAgICAgICByZXR1cm4gYi5ic3QuTiAtIGEuYnN0Lk47XG4gICAgICAgIH0pO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlYWZzLmxlbmd0aDsgaSsrKSBsZWFmc1tpXS5pbmQgPSBpO1xuICAgICAgICByZXR1cm4gW3Jvb3QsIGxlYWZzXTtcbiAgICB9XG5cbiAgICBVUE5HLnF1YW50aXplLmdldE5lYXJlc3QgPSBmdW5jdGlvbiAobmQsIHIsIGcsIGIsIGEpIHtcbiAgICAgICAgaWYgKG5kLmxlZnQgPT0gbnVsbCkge1xuICAgICAgICAgICAgbmQudGRzdCA9IFVQTkcucXVhbnRpemUuZGlzdChuZC5lc3QucSwgciwgZywgYiwgYSk7XG4gICAgICAgICAgICByZXR1cm4gbmQ7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHBsYW5lRHN0ID0gVVBORy5xdWFudGl6ZS5wbGFuZURzdChuZC5lc3QsIHIsIGcsIGIsIGEpO1xuXG4gICAgICAgIHZhciBub2RlMCA9IG5kLmxlZnQsXG4gICAgICAgICAgICBub2RlMSA9IG5kLnJpZ2h0O1xuICAgICAgICBpZiAocGxhbmVEc3QgPiAwKSB7XG4gICAgICAgICAgICBub2RlMCA9IG5kLnJpZ2h0O1xuICAgICAgICAgICAgbm9kZTEgPSBuZC5sZWZ0O1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGxuID0gVVBORy5xdWFudGl6ZS5nZXROZWFyZXN0KG5vZGUwLCByLCBnLCBiLCBhKTtcbiAgICAgICAgaWYgKGxuLnRkc3QgPD0gcGxhbmVEc3QgKiBwbGFuZURzdCkgcmV0dXJuIGxuO1xuICAgICAgICB2YXIgcm4gPSBVUE5HLnF1YW50aXplLmdldE5lYXJlc3Qobm9kZTEsIHIsIGcsIGIsIGEpO1xuICAgICAgICByZXR1cm4gcm4udGRzdCA8IGxuLnRkc3QgPyBybiA6IGxuO1xuICAgIH1cbiAgICBVUE5HLnF1YW50aXplLnBsYW5lRHN0ID0gZnVuY3Rpb24gKGVzdCwgciwgZywgYiwgYSkge1xuICAgICAgICB2YXIgZSA9IGVzdC5lO1xuICAgICAgICByZXR1cm4gZVswXSAqIHIgKyBlWzFdICogZyArIGVbMl0gKiBiICsgZVszXSAqIGEgLSBlc3QuZU1xO1xuICAgIH1cbiAgICBVUE5HLnF1YW50aXplLmRpc3QgPSBmdW5jdGlvbiAocSwgciwgZywgYiwgYSkge1xuICAgICAgICB2YXIgZDAgPSByIC0gcVswXSxcbiAgICAgICAgICAgIGQxID0gZyAtIHFbMV0sXG4gICAgICAgICAgICBkMiA9IGIgLSBxWzJdLFxuICAgICAgICAgICAgZDMgPSBhIC0gcVszXTtcbiAgICAgICAgcmV0dXJuIGQwICogZDAgKyBkMSAqIGQxICsgZDIgKiBkMiArIGQzICogZDM7XG4gICAgfVxuXG4gICAgVVBORy5xdWFudGl6ZS5zcGxpdFBpeGVscyA9IGZ1bmN0aW9uIChuaW1nLCBuaW1nMzIsIGkwLCBpMSwgZSwgZU1xKSB7XG4gICAgICAgIHZhciB2ZWNEb3QgPSBVUE5HLnF1YW50aXplLnZlY0RvdDtcbiAgICAgICAgaTEgLT0gNDtcbiAgICAgICAgdmFyIHNoZnMgPSAwO1xuICAgICAgICB3aGlsZSAoaTAgPCBpMSkge1xuICAgICAgICAgICAgd2hpbGUgKHZlY0RvdChuaW1nLCBpMCwgZSkgPD0gZU1xKSBpMCArPSA0O1xuICAgICAgICAgICAgd2hpbGUgKHZlY0RvdChuaW1nLCBpMSwgZSkgPiBlTXEpIGkxIC09IDQ7XG4gICAgICAgICAgICBpZiAoaTAgPj0gaTEpIGJyZWFrO1xuXG4gICAgICAgICAgICB2YXIgdCA9IG5pbWczMltpMCA+PiAyXTtcbiAgICAgICAgICAgIG5pbWczMltpMCA+PiAyXSA9IG5pbWczMltpMSA+PiAyXTtcbiAgICAgICAgICAgIG5pbWczMltpMSA+PiAyXSA9IHQ7XG5cbiAgICAgICAgICAgIGkwICs9IDQ7XG4gICAgICAgICAgICBpMSAtPSA0O1xuICAgICAgICB9XG4gICAgICAgIHdoaWxlICh2ZWNEb3QobmltZywgaTAsIGUpID4gZU1xKSBpMCAtPSA0O1xuICAgICAgICByZXR1cm4gaTAgKyA0O1xuICAgIH1cbiAgICBVUE5HLnF1YW50aXplLnZlY0RvdCA9IGZ1bmN0aW9uIChuaW1nLCBpLCBlKSB7XG4gICAgICAgIHJldHVybiBuaW1nW2ldICogZVswXSArIG5pbWdbaSArIDFdICogZVsxXSArIG5pbWdbaSArIDJdICogZVsyXSArIG5pbWdbaSArIDNdICogZVszXTtcbiAgICB9XG4gICAgVVBORy5xdWFudGl6ZS5zdGF0cyA9IGZ1bmN0aW9uIChuaW1nLCBpMCwgaTEpIHtcbiAgICAgICAgdmFyIFIgPSBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF07XG4gICAgICAgIHZhciBtID0gWzAsIDAsIDAsIDBdO1xuICAgICAgICB2YXIgTiA9IChpMSAtIGkwKSA+PiAyO1xuICAgICAgICBmb3IgKHZhciBpID0gaTA7IGkgPCBpMTsgaSArPSA0KSB7XG4gICAgICAgICAgICB2YXIgciA9IG5pbWdbaV0gKiAoMSAvIDI1NSksXG4gICAgICAgICAgICAgICAgZyA9IG5pbWdbaSArIDFdICogKDEgLyAyNTUpLFxuICAgICAgICAgICAgICAgIGIgPSBuaW1nW2kgKyAyXSAqICgxIC8gMjU1KSxcbiAgICAgICAgICAgICAgICBhID0gbmltZ1tpICsgM10gKiAoMSAvIDI1NSk7XG4gICAgICAgICAgICAvL3ZhciByID0gbmltZ1tpXSwgZyA9IG5pbWdbaSsxXSwgYiA9IG5pbWdbaSsyXSwgYSA9IG5pbWdbaSszXTtcbiAgICAgICAgICAgIG1bMF0gKz0gcjtcbiAgICAgICAgICAgIG1bMV0gKz0gZztcbiAgICAgICAgICAgIG1bMl0gKz0gYjtcbiAgICAgICAgICAgIG1bM10gKz0gYTtcblxuICAgICAgICAgICAgUlswXSArPSByICogcjtcbiAgICAgICAgICAgIFJbMV0gKz0gciAqIGc7XG4gICAgICAgICAgICBSWzJdICs9IHIgKiBiO1xuICAgICAgICAgICAgUlszXSArPSByICogYTtcbiAgICAgICAgICAgIFJbNV0gKz0gZyAqIGc7XG4gICAgICAgICAgICBSWzZdICs9IGcgKiBiO1xuICAgICAgICAgICAgUls3XSArPSBnICogYTtcbiAgICAgICAgICAgIFJbMTBdICs9IGIgKiBiO1xuICAgICAgICAgICAgUlsxMV0gKz0gYiAqIGE7XG4gICAgICAgICAgICBSWzE1XSArPSBhICogYTtcbiAgICAgICAgfVxuICAgICAgICBSWzRdID0gUlsxXTtcbiAgICAgICAgUls4XSA9IFJbMl07XG4gICAgICAgIFJbOV0gPSBSWzZdO1xuICAgICAgICBSWzEyXSA9IFJbM107XG4gICAgICAgIFJbMTNdID0gUls3XTtcbiAgICAgICAgUlsxNF0gPSBSWzExXTtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgUjogUixcbiAgICAgICAgICAgIG06IG0sXG4gICAgICAgICAgICBOOiBOXG4gICAgICAgIH07XG4gICAgfVxuICAgIFVQTkcucXVhbnRpemUuZXN0YXRzID0gZnVuY3Rpb24gKHN0YXRzKSB7XG4gICAgICAgIHZhciBSID0gc3RhdHMuUixcbiAgICAgICAgICAgIG0gPSBzdGF0cy5tLFxuICAgICAgICAgICAgTiA9IHN0YXRzLk47XG5cbiAgICAgICAgLy8gd2hlbiBhbGwgc2FtcGxlcyBhcmUgZXF1YWwsIGJ1dCBOIGlzIGxhcmdlIChtaWxsaW9ucyksIHRoZSBSaiBjYW4gYmUgbm9uLXplcm8gKCAwLjAwMDMuLi4uIC0gcHJlY2lzc2lvbiBlcnJvcilcbiAgICAgICAgdmFyIG0wID0gbVswXSxcbiAgICAgICAgICAgIG0xID0gbVsxXSxcbiAgICAgICAgICAgIG0yID0gbVsyXSxcbiAgICAgICAgICAgIG0zID0gbVszXSxcbiAgICAgICAgICAgIGlOID0gKE4gPT0gMCA/IDAgOiAxIC8gTik7XG4gICAgICAgIHZhciBSaiA9IFtSWzBdIC0gbTAgKiBtMCAqIGlOLCBSWzFdIC0gbTAgKiBtMSAqIGlOLCBSWzJdIC0gbTAgKiBtMiAqIGlOLCBSWzNdIC0gbTAgKiBtMyAqIGlOLCBSWzRdIC0gbTEgKiBtMCAqIGlOLCBSWzVdIC0gbTEgKiBtMSAqIGlOLCBSWzZdIC0gbTEgKiBtMiAqIGlOLCBSWzddIC0gbTEgKiBtMyAqIGlOLCBSWzhdIC0gbTIgKiBtMCAqIGlOLCBSWzldIC0gbTIgKiBtMSAqIGlOLCBSWzEwXSAtIG0yICogbTIgKiBpTiwgUlsxMV0gLSBtMiAqIG0zICogaU4sIFJbMTJdIC0gbTMgKiBtMCAqIGlOLCBSWzEzXSAtIG0zICogbTEgKiBpTiwgUlsxNF0gLSBtMyAqIG0yICogaU4sIFJbMTVdIC0gbTMgKiBtMyAqIGlOXTtcblxuICAgICAgICB2YXIgQSA9IFJqLFxuICAgICAgICAgICAgTSA9IFVQTkcuTTQ7XG4gICAgICAgIHZhciBiID0gWzAuNSwgMC41LCAwLjUsIDAuNV0sXG4gICAgICAgICAgICBtaSA9IDAsXG4gICAgICAgICAgICB0bWkgPSAwO1xuXG4gICAgICAgIGlmIChOICE9IDApXG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IDEwOyBpKyspIHtcbiAgICAgICAgICAgICAgICBiID0gTS5tdWx0VmVjKEEsIGIpO1xuICAgICAgICAgICAgICAgIHRtaSA9IE1hdGguc3FydChNLmRvdChiLCBiKSk7XG4gICAgICAgICAgICAgICAgYiA9IE0uc21sKDEgLyB0bWksIGIpO1xuICAgICAgICAgICAgICAgIGlmIChNYXRoLmFicyh0bWkgLSBtaSkgPCAxZS05KSBicmVhaztcbiAgICAgICAgICAgICAgICBtaSA9IHRtaTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgLy9iID0gWzAsMCwxLDBdOyAgbWk9TjtcbiAgICAgICAgdmFyIHEgPSBbbTAgKiBpTiwgbTEgKiBpTiwgbTIgKiBpTiwgbTMgKiBpTl07XG4gICAgICAgIHZhciBlTXEyNTUgPSBNLmRvdChNLnNtbCgyNTUsIHEpLCBiKTtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgQ292OiBSaixcbiAgICAgICAgICAgIHE6IHEsXG4gICAgICAgICAgICBlOiBiLFxuICAgICAgICAgICAgTDogbWksXG4gICAgICAgICAgICBlTXEyNTU6IGVNcTI1NSxcbiAgICAgICAgICAgIGVNcTogTS5kb3QoYiwgcSksXG4gICAgICAgICAgICByZ2JhOiAoKChNYXRoLnJvdW5kKDI1NSAqIHFbM10pIDw8IDI0KSB8IChNYXRoLnJvdW5kKDI1NSAqIHFbMl0pIDw8IDE2KSB8IChNYXRoLnJvdW5kKDI1NSAqIHFbMV0pIDw8IDgpIHwgKE1hdGgucm91bmQoMjU1ICogcVswXSkgPDwgMCkpID4+PiAwKVxuICAgICAgICB9O1xuICAgIH1cbiAgICBVUE5HLk00ID0ge1xuICAgICAgICBtdWx0VmVjOiBmdW5jdGlvbiAobSwgdikge1xuICAgICAgICAgICAgcmV0dXJuIFttWzBdICogdlswXSArIG1bMV0gKiB2WzFdICsgbVsyXSAqIHZbMl0gKyBtWzNdICogdlszXSwgbVs0XSAqIHZbMF0gKyBtWzVdICogdlsxXSArIG1bNl0gKiB2WzJdICsgbVs3XSAqIHZbM10sIG1bOF0gKiB2WzBdICsgbVs5XSAqIHZbMV0gKyBtWzEwXSAqIHZbMl0gKyBtWzExXSAqIHZbM10sIG1bMTJdICogdlswXSArIG1bMTNdICogdlsxXSArIG1bMTRdICogdlsyXSArIG1bMTVdICogdlszXV07XG4gICAgICAgIH0sXG4gICAgICAgIGRvdDogZnVuY3Rpb24gKHgsIHkpIHtcbiAgICAgICAgICAgIHJldHVybiB4WzBdICogeVswXSArIHhbMV0gKiB5WzFdICsgeFsyXSAqIHlbMl0gKyB4WzNdICogeVszXTtcbiAgICAgICAgfSxcbiAgICAgICAgc21sOiBmdW5jdGlvbiAoYSwgeSkge1xuICAgICAgICAgICAgcmV0dXJuIFthICogeVswXSwgYSAqIHlbMV0sIGEgKiB5WzJdLCBhICogeVszXV07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBVUE5HLmVuY29kZS5jb25jYXRSR0JBID0gZnVuY3Rpb24gKGJ1ZnMsIHJvdW5kQWxwaGEpIHtcbiAgICAgICAgdmFyIHRsZW4gPSAwO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGJ1ZnMubGVuZ3RoOyBpKyspIHRsZW4gKz0gYnVmc1tpXS5ieXRlTGVuZ3RoO1xuICAgICAgICB2YXIgbmltZyA9IG5ldyBVaW50OEFycmF5KHRsZW4pLFxuICAgICAgICAgICAgbm9mZiA9IDA7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYnVmcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGltZyA9IG5ldyBVaW50OEFycmF5KGJ1ZnNbaV0pLFxuICAgICAgICAgICAgICAgIGlsID0gaW1nLmxlbmd0aDtcbiAgICAgICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgaWw7IGogKz0gNCkge1xuICAgICAgICAgICAgICAgIHZhciByID0gaW1nW2pdLFxuICAgICAgICAgICAgICAgICAgICBnID0gaW1nW2ogKyAxXSxcbiAgICAgICAgICAgICAgICAgICAgYiA9IGltZ1tqICsgMl0sXG4gICAgICAgICAgICAgICAgICAgIGEgPSBpbWdbaiArIDNdO1xuICAgICAgICAgICAgICAgIGlmIChyb3VuZEFscGhhKSBhID0gKGEgJiAxMjgpID09IDAgPyAwIDogMjU1O1xuICAgICAgICAgICAgICAgIGlmIChhID09IDApIHIgPSBnID0gYiA9IDA7XG4gICAgICAgICAgICAgICAgbmltZ1tub2ZmICsgal0gPSByO1xuICAgICAgICAgICAgICAgIG5pbWdbbm9mZiArIGogKyAxXSA9IGc7XG4gICAgICAgICAgICAgICAgbmltZ1tub2ZmICsgaiArIDJdID0gYjtcbiAgICAgICAgICAgICAgICBuaW1nW25vZmYgKyBqICsgM10gPSBhO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbm9mZiArPSBpbDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbmltZy5idWZmZXI7XG4gICAgfVxuXG59KShVUE5HLCBwYWtvKTtcblxuZXhwb3J0IGRlZmF1bHQgVVBORzsiLCJpbXBvcnQgJGdldEV4ZU5hbWUgZnJvbSAnLi9saWIvX2dldEV4ZU5hbWUnICAgICAgICAvLyDnlKjkuo7ojrflj5bot6/lvoTmianlsZXlkI1cbmltcG9ydCAkb21nZ2lmIGZyb20gJy4vbGliL19vbWdnaWYnICAgICAgICAgICAgICAgIC8vIGdpZuWbvueJh+e8luino+eggVxuaW1wb3J0ICR1cG5nanMgZnJvbSAnLi9saWIvX3VwbmcnICAgICAgICAgICAgICAgICAgLy8gcG5n5Zu+54mH57yW6Kej56CBXG5cbmNsYXNzIEltYWdle1xuICAgIGNvbnN0cnVjdG9yKGVzb3VyY2UscmVzb3VyY2VzKXtcbiAgICAgICAgY29uc3QgX3RzID0gdGhpcztcbiAgICAgICAgX3RzLmVzb3VyY2UgPSBlc291cmNlO1xuICAgICAgICBfdHMucmVzb3VyY2VzID0gcmVzb3VyY2VzO1xuXG4gICAgICAgIF90cy5pbml0KCk7XG4gICAgfVxuICAgIGluaXQoKXtcbiAgICAgICAgY29uc3QgX3RzID0gdGhpcyxcbiAgICAgICAgICAgIGVzb3VyY2UgPSBfdHMuZXNvdXJjZSxcbiAgICAgICAgICAgIHJlc291cmNlcyA9IF90cy5yZXNvdXJjZXM7XG5cbiAgICAgICAgX3RzLnRlbXAgPSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIOS4tOaXtuaVsOaNrlxuICAgICAgICAgICAgLy9sb29wOjAsICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8g5L+d5a2Y5b2T5YmN6ZyA6KaB5pKt5pS+55qE5qyh5pWwXG4gICAgICAgICAgICAvL3RpY2tlcklzQWRkOnVuZGVmaW5lZCAgICAgICAgICAgICAgICAgICAgICAgICAvLyDkv53lrZjova7lvqrmiafooYzlmajmmK/lkKbmt7vliqBcbiAgICAgICAgICAgIGV2ZW50czp7fSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIOeUqOS6juWtmOaUvuS6i+S7tlxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIOWxnuaAp1xuICAgICAgICBfdHMuX19hdHRyID0ge1xuICAgICAgICAgICAgYXV0b1BsYXk6dHJ1ZSwgICAgIC8vIOm7mOiupOiHquWKqOaSreaUvlxuICAgICAgICAgICAgbG9vcDowICAgICAgICAgICAgIC8vIOm7mOiupOaXoOmZkOasoeaSreaUvlxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIOaWueazlVxuICAgICAgICBfdHMuX19tZXRob2QgPSB7XG4gICAgICAgICAgICBwbGF5Ol90cy5wbGF5ICAgICAgIC8vIOaSreaUvuaWueazlVxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIOeKtuaAgVxuICAgICAgICBfdHMuX19zdGF0dXMgPSB7XG4gICAgICAgICAgICBzdGF0dXM6J2luaXQnLCAgICAgIC8vIOeKtuaAge+8jOm7mOiupOWIneWni+WMlu+8iGluaXTjgIFwbGF5aW5n44CBcGxheWVk44CBcGF1c2XjgIFzdG9w77yJXG4gICAgICAgICAgICBmcmFtZTowLCAgICAgICAgICAgIC8vIOW9k+WJjeW4p+aVsFxuICAgICAgICAgICAgbG9vcHM6MCwgICAgICAgICAgICAvLyDov57nu63lvqrnjq/mkq3mlL7mrKHmlbDvvIzlgZzmraLmkq3mlL7kvJrmuIUwXG4gICAgICAgICAgICB0aW1lOjBcbiAgICAgICAgfTtcbiAgICAgICAgXG4gICAgICAgIC8vIOW+queOr+aJp+ihjOWZqFxuICAgICAgICBfdHMudGlja2VyID0gbmV3IFBJWEkuVGlja2VyKCk7XG4gICAgICAgIF90cy50aWNrZXIuc3RvcCgpO1xuXG4gICAgICAgIC8vIOeyvueBtVxuICAgICAgICBfdHMuc3ByaXRlID0gdGhpcy5jcmVhdGVTcHJpdGUoZXNvdXJjZSxyZXNvdXJjZXMpO1xuICAgIH1cblxuICAgIC8vIOaSreaUvlxuICAgIHBsYXkobG9vcCxjYWxsYmFjayl7XG4gICAgICAgIGNvbnN0IF90cyA9IHRoaXM7XG5cbiAgICAgICAgLy8g5rKh5pyJ57q555CG5p2Q6LSo5pe25oqb5Ye66ZSZ6K+vXG4gICAgICAgIGlmKCFfdHMudGV4dHVyZXMubGVuZ3RoKXtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcign5rKh5pyJ5Y+v55So55qEdGV4dHVyZXMnKTtcbiAgICAgICAgfTtcblxuICAgICAgICAvLyDnurnnkIbmnZDotKjlj6rmnInkuIDluKfml7bkuI3lvoDkuIvmiafooYxcbiAgICAgICAgaWYoX3RzLnRleHR1cmVzLmxlbmd0aCA9PT0gMSl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH07XG5cbiAgICAgICAgbGV0IHN0YXR1cyA9IF90cy5fX3N0YXR1cyxcbiAgICAgICAgICAgIGF0dHIgPSBfdHMuX19hdHRyLFxuICAgICAgICAgICAgdGltZSA9IDA7XG5cbiAgICAgICAgLy8g5b2T54q25oCB5piv5YGc5q2i55qE5pe25YCZ77yM5bCG5pKt5pS+5qyh5pWw5riFMFxuICAgICAgICBpZihzdGF0dXMuc3RhdHVzID09PSAnc3RvcCcpe1xuICAgICAgICAgICAgc3RhdHVzLmxvb3BzID0gMDtcbiAgICAgICAgfTtcblxuICAgICAgICAvLyDorr7nva7lvqrnjq/lj4LmlbBcbiAgICAgICAgbG9vcCA9IHR5cGVvZiBsb29wID09PSAnbnVtYmVyJyA/IGxvb3AgOiBhdHRyLmxvb3A7XG4gICAgICAgIF90cy50ZW1wLmxvb3AgPSBsb29wO1xuICAgICAgICBhdHRyLmxvb3AgPSBsb29wO1xuICAgICAgICBcbiAgICAgICAgLy8g5Li66L2u5b6q5omn6KGM5Zmo5re75Yqg5LiA5Liq5pON5L2cXG4gICAgICAgIGlmKCFfdHMudGVtcC50aWNrZXJJc0FkZCl7XG4gICAgICAgICAgICBfdHMudGlja2VyLmFkZChkZWx0YVRpbWUgPT4ge1xuICAgICAgICAgICAgICAgIGxldCBlbGFwc2VkID0gUElYSS5UaWNrZXIuc2hhcmVkLmVsYXBzZWRNUztcbiAgICAgICAgICAgICAgICB0aW1lKz1lbGFwc2VkO1xuXG4gICAgICAgICAgICAgICAgLy8g5b2T5bin5YGc55WZ5pe26Ze05bey6L6+5Yiw6Ze06ZqU5bin546H5pe25pKt5pS+5LiL5LiA5binXG4gICAgICAgICAgICAgICAgaWYodGltZSA+IF90cy5mcmFtZXNEZWxheVtzdGF0dXMuZnJhbWVdKXtcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzLmZyYW1lKys7XG5cbiAgICAgICAgICAgICAgICAgICAgLy8g5L+u5pS554q25oCB5Li65omn6KGM5LitXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cy5zdGF0dXMgPSAncGxheWluZyc7XG4gICAgXG4gICAgICAgICAgICAgICAgICAgIC8vIOW9k+S4gOasoeaSreaUvuWujOaIkO+8jOWwhuaSreaUvuW4p+W9kjDvvIzlubborrDlvZXmkq3mlL7mrKHmlbBcbiAgICAgICAgICAgICAgICAgICAgaWYoc3RhdHVzLmZyYW1lID4gX3RzLnRleHR1cmVzLmxlbmd0aCAtIDEpe1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzLmZyYW1lID0gMDtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1cy5sb29wcysrO1xuICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgLy8g5b2T5oyH5a6a5LqG5pyJ5pWI55qE5pKt5pS+5qyh5pWw5bm25LiU5b2T5YmN5pKt5pS+5qyh5pWw6L6+5Yiw5oyH5a6a5qyh5pWw5pe277yM5omn6KGM5Zue6LCD5YiZ5YGc5q2i5pKt5pS+XG4gICAgICAgICAgICAgICAgICAgICAgICBpZihfdHMudGVtcC5sb29wID4gMCAmJiBzdGF0dXMubG9vcHMgPj0gX3RzLnRlbXAubG9vcCl7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYodHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nKXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2soc3RhdHVzKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIOS/ruaUueeKtuaAgeS4uuaJp+ihjOWujOaIkOW5tuWBnOatolxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1cy5zdGF0dXMgPSAncGxheWVkJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBfdHMucnVuRXZlbnQoJ3BsYXllZCcsc3RhdHVzKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBfdHMuc3RvcCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICBcbiAgICAgICAgICAgICAgICAgICAgLy8g5L+u5pS557K+54G157q555CG5p2Q6LSo5LiO5b2T5YmN55qE5bin546H55u45Yy56YWNXG4gICAgICAgICAgICAgICAgICAgIF90cy5zcHJpdGUudGV4dHVyZSA9IF90cy50ZXh0dXJlc1tzdGF0dXMuZnJhbWVdO1xuICAgICAgICAgICAgICAgICAgICB0aW1lID0gMDtcblxuICAgICAgICAgICAgICAgICAgICBfdHMucnVuRXZlbnQoJ3BsYXlpbmcnLHN0YXR1cyk7XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgX3RzLnRlbXAudGlja2VySXNBZGQgPSB0cnVlO1xuICAgICAgICB9O1xuICAgICAgICBcbiAgICAgICAgLy8g6K6p6L2u5b6q5omn6KGM5Zmo5byA5aeL5omn6KGMXG4gICAgICAgIF90cy50aWNrZXIuc3RhcnQoKTtcbiAgICB9XG5cbiAgICAvLyDmmoLlgZxcbiAgICBwYXVzZSgpe1xuICAgICAgICBjb25zdCBfdHMgPSB0aGlzLFxuICAgICAgICAgICAgc3RhdHVzID0gX3RzLl9fc3RhdHVzO1xuICAgICAgICBfdHMudGlja2VyLnN0b3AoKTtcbiAgICAgICAgc3RhdHVzLnN0YXR1cyA9ICdwYXVzZSc7XG4gICAgICAgIF90cy5ydW5FdmVudCgncGF1c2UnLHN0YXR1cyk7XG4gICAgfVxuXG4gICAgLy8g5YGc5q2i5pKt5pS+5bm26Lez6Iez56ys5LiA5binXG4gICAgc3RvcCgpe1xuICAgICAgICBjb25zdCBfdHMgPSB0aGlzLFxuICAgICAgICAgICAgc3RhdHVzID0gX3RzLl9fc3RhdHVzO1xuICAgICAgICBfdHMudGlja2VyLnN0b3AoKTtcbiAgICAgICAgc3RhdHVzLnN0YXR1cyA9ICdzdG9wJzsgXG4gICAgICAgIF90cy5ydW5FdmVudCgnc3RvcCcsc3RhdHVzKTtcbiAgICB9XG5cbiAgICAvLyDot7Poh7PmjIflrprnmoTluKfmlbBcbiAgICBqdW1wVG9GcmFtZShmcmFtZUluZGV4KXtcbiAgICAgICAgY29uc3QgX3RzID0gdGhpcyxcbiAgICAgICAgICAgIHRleHR1cmVzID0gX3RzLnRleHR1cmVzO1xuXG4gICAgICAgIC8vIOayoeaciee6ueeQhuadkOi0qOaXtuaKm+WHuumUmeivr1xuICAgICAgICBpZighdGV4dHVyZXMubGVuZ3RoKXtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcign5rKh5pyJ5Y+v55So55qEdGV4dHVyZXMnKTtcbiAgICAgICAgfTtcblxuICAgICAgICBsZXQgc3RhdHVzID0gX3RzLl9fc3RhdHVzO1xuXG4gICAgICAgIGZyYW1lSW5kZXggPSBmcmFtZUluZGV4IDwgMCA/IDAgOiBmcmFtZUluZGV4ID4gdGV4dHVyZXMubGVuZ3RoIC0gMSA/IHRleHR1cmVzLmxlbmd0aCAtIDEgOiBmcmFtZUluZGV4O1xuXG4gICAgICAgIGlmKHR5cGVvZiBmcmFtZUluZGV4ID09PSAnbnVtYmVyJyl7XG4gICAgICAgICAgICBfdHMuc3ByaXRlLnRleHR1cmUgPSB0ZXh0dXJlc1tmcmFtZUluZGV4XTtcbiAgICAgICAgICAgIHN0YXR1cy5mcmFtZSA9IGZyYW1lSW5kZXg7XG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLy8g6I635Y+W5oC75pKt5pS+5pe26ZW/XG4gICAgZ2V0RHVyYXRpb24oKXtcbiAgICAgICAgY29uc3QgX3RzID0gdGhpcyxcbiAgICAgICAgICAgIGZyYW1lc0RlbGF5ID0gX3RzLmZyYW1lc0RlbGF5O1xuICAgICAgICBcbiAgICAgICAgLy8g5rKh5pyJ5bin5pe26Ze05pe25oqb5Ye66ZSZ6K+vXG4gICAgICAgIGlmKCFmcmFtZXNEZWxheS5sZW5ndGgpe1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCfmnKrmib7liLDlm77niYfluKfml7bpl7QnKTtcbiAgICAgICAgfTtcblxuICAgICAgICBsZXQgdGltZSA9IDA7XG5cbiAgICAgICAgZm9yKGxldCBpPTAsbGVuPWZyYW1lc0RlbGF5Lmxlbmd0aDsgaTxsZW47IGkrKyl7XG4gICAgICAgICAgICB0aW1lICs9IGZyYW1lc0RlbGF5W2ldO1xuICAgICAgICB9O1xuICAgICAgICByZXR1cm4gdGltZTtcbiAgICB9XG5cbiAgICAvLyDojrflj5bmgLvluKfmlbBcbiAgICBnZXRGcmFtZXNMZW5ndGgoKXtcbiAgICAgICAgY29uc3QgX3RzID0gdGhpcztcbiAgICAgICAgLy8g5rKh5pyJ57q555CG5p2Q6LSo5pe25oqb5Ye66ZSZ6K+vXG4gICAgICAgIGlmKCFfdHMudGV4dHVyZXMubGVuZ3RoKXtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcign5rKh5pyJ5Y+v55So55qEdGV4dHVyZXMnKTtcbiAgICAgICAgfTtcbiAgICAgICAgcmV0dXJuIF90cy50ZXh0dXJlcy5sZW5ndGg7XG4gICAgfVxuXG4gICAgLy8g5LqL5Lu2XG4gICAgb24odHlwZSxmdW4pe1xuICAgICAgICBjb25zdCBfdHMgPSB0aGlzO1xuXG4gICAgICAgIHN3aXRjaCAodHlwZSkge1xuICAgICAgICAgICAgY2FzZSAncGxheWluZyc6XG4gICAgICAgICAgICBjYXNlICdwbGF5ZWQnOlxuICAgICAgICAgICAgY2FzZSAncGF1c2UnOlxuICAgICAgICAgICAgY2FzZSAnc3RvcCc6XG4gICAgICAgICAgICAgICAgX3RzLnRlbXAuZXZlbnRzW3R5cGVdID0gZnVuO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcign5peg5pWI55qE5LqL5Lu2Jyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJ1bkV2ZW50KHR5cGUsc3RhdHVzKXtcbiAgICAgICAgbGV0IHRlbXAgPSB0aGlzLnRlbXA7XG4gICAgICAgIGlmKHR5cGVvZiB0ZW1wLmV2ZW50c1t0eXBlXSA9PT0gJ2Z1bmN0aW9uJyl7XG4gICAgICAgICAgICB0ZW1wLmV2ZW50c1t0eXBlXShzdGF0dXMpO1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIOWIm+W7uueyvueBtVxuICAgICAqIEBwYXJhbSAge2FycmF5OnN0cmluZ319IGltZ1NyYyDlm77niYfotYTmupDot6/lvoRcbiAgICAgKiBAcGFyYW0gIHtvYmplY3R9IHJlc291cmNlcyDlt7Lnu4/liqDovb3nmoTnvJPlrZjotYTmupBcbiAgICAgKiBAcmV0dXJuIHtvYmplY3R9IOi/lOWbnueyvueBtVxuICAgICAqL1xuICAgIGNyZWF0ZVNwcml0ZShlc291cmNlLHJlc291cmNlcyl7XG4gICAgICAgIGNvbnN0IF90cyA9IHRoaXM7XG5cbiAgICAgICAgbGV0IFNwcml0ZSA9IFBJWEkuU3ByaXRlLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpbWdTcmMgPSBlc291cmNlLFxuICAgICAgICAgICAgZXhlTmFtZSA9ICRnZXRFeGVOYW1lKGltZ1NyYy50b0xvY2FsZUxvd2VyQ2FzZSgpKTtcbiAgICAgICAgXG4gICAgICAgIC8vIOaWh+S7tuaJqeWxleWQjeS4umdpZuaIlnBuZ+WImei/lOWbnuWvueW6lOeahOWQjeensO+8jOWFtuWug+WPjei/lOWbnm90aGVyXG4gICAgICAgIGV4ZU5hbWUgPSBleGVOYW1lID09PSAnZ2lmJyB8fCBleGVOYW1lID09PSAncG5nJyA/IGV4ZU5hbWUgOiAnb3RoZXInO1xuXG4gICAgICAgIGxldCBmdW5zID0ge1xuICAgICAgICAgICAgJ2dpZic6KCk9PntcbiAgICAgICAgICAgICAgICBsZXQgZ2lmRGVjb2RlRGF0YSA9IF90cy5naWZSZXNvdXJjZVRvVGV4dHVyZXMocmVzb3VyY2VzW2ltZ1NyY10pO1xuICAgICAgICAgICAgICAgIF90cy50ZXh0dXJlcyA9IGdpZkRlY29kZURhdGEudGV4dHVyZXM7XG4gICAgICAgICAgICAgICAgX3RzLmZyYW1lc0RlbGF5ID0gZ2lmRGVjb2RlRGF0YS5kZWxheVRpbWVzO1xuICAgICAgICAgICAgICAgIF90cy5wbGF5KCk7XG5cbiAgICAgICAgICAgICAgICAvLyDov5Tlm57nsr7ngbXlubblsIbnurnnkIbmnZDotKjorr7nva7kuLrnrKzkuIDluKflm77lg49cbiAgICAgICAgICAgICAgICByZXR1cm4gbmV3IFNwcml0ZShfdHMudGV4dHVyZXNbMF0pO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICdwbmcnOigpPT57XG4gICAgICAgICAgICAgICAgbGV0IHBuZ0RlY29kZURhdGEgPSBfdHMuYXBuZ1Jlc291cmNlVG9UZXh0dXJlcyhyZXNvdXJjZXNbaW1nU3JjXSk7XG4gICAgICAgICAgICAgICAgX3RzLnRleHR1cmVzID0gcG5nRGVjb2RlRGF0YS50ZXh0dXJlcztcbiAgICAgICAgICAgICAgICBfdHMuZnJhbWVzRGVsYXkgPSBwbmdEZWNvZGVEYXRhLmRlbGF5VGltZXM7XG4gICAgICAgICAgICAgICAgX3RzLnBsYXkoKTtcblxuICAgICAgICAgICAgICAgIC8vIOi/lOWbnueyvueBteW5tuWwhue6ueeQhuadkOi0qOiuvue9ruS4uuesrOS4gOW4p+WbvuWDj1xuICAgICAgICAgICAgICAgIHJldHVybiBuZXcgU3ByaXRlKF90cy50ZXh0dXJlc1swXSk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgJ290aGVyJzooKT0+e1xuICAgICAgICAgICAgICAgIF90cy50ZXh0dXJlcyA9IFtyZXNvdXJjZXNbaW1nU3JjXS50ZXh0dXJlXTtcbiAgICAgICAgICAgICAgICByZXR1cm4gbmV3IFNwcml0ZShyZXNvdXJjZXNbaW1nU3JjXS50ZXh0dXJlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgcmV0dXJuIGZ1bnNbZXhlTmFtZV0oKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiDlsIZhcG5n57yT5a2Y6LWE5rqQ6L2s5o2i5Li657q555CG5p2Q6LSoXG4gICAgICogQHBhcmFtICB7b2JqZWN0fSByZXNvdXJjZSAgICDnvJPlrZjotYTmupBcbiAgICAgKiBAcmV0dXJuIHtvYmplY3R9IOi/lOWbnuS4gOS4quWvueixoe+8jOWMheaLrGFwbmfnmoTmr4/luKfml7bplb/lj4rop6PnoIHlh7rmnaXmnZDotKhcbiAgICAgKi9cbiAgICBhcG5nUmVzb3VyY2VUb1RleHR1cmVzKHJlc291cmNlKXtcbiAgICAgICAgY29uc3QgX3RzID0gdGhpcztcblxuICAgICAgICBsZXQgb2JqID0ge1xuICAgICAgICAgICAgICAgIGRlbGF5VGltZXM6W10sXG4gICAgICAgICAgICAgICAgdGV4dHVyZXM6W11cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBidWYgPSBuZXcgVWludDhBcnJheShyZXNvdXJjZS5kYXRhKSxcbiAgICAgICAgICAgIHVwbmcgPSAkdXBuZ2pzLmRlY29kZShidWYpLFxuICAgICAgICAgICAgcmdiYSA9ICR1cG5nanMudG9SR0JBOCh1cG5nKSxcbiAgICAgICAgICAgIHBuZ1dpZHRoID0gdXBuZy53aWR0aCxcbiAgICAgICAgICAgIHBuZ0hlaWdodCA9IHVwbmcuaGVpZ2h0LFxuICAgICAgICAgICAgcG5nRnJhbWVzTGVuID0gdXBuZy5mcmFtZXMubGVuZ3RoLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBzcHJpdGVTaGVldCxcbiAgICAgICAgICAgIGNhbnZhcyxcbiAgICAgICAgICAgIGN0eCxcbiAgICAgICAgICAgIGltYWdlRGF0YTtcblxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIC8vIOiusOW9leS4i+avj+W4p+eahOaXtumXtFxuICAgICAgICB1cG5nLmZyYW1lcy5mb3JFYWNoKChpdGVtLGluZGV4KT0+e1xuICAgICAgICAgICAgb2JqLmRlbGF5VGltZXMucHVzaChpdGVtLmRlbGF5KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgZm9yKGxldCBpPTAsbGVuPXJnYmEubGVuZ3RoOyBpPGxlbjsgaSsrKXtcbiAgICAgICAgICAgIGxldCBpdGVtID0gcmdiYVtpXSxcbiAgICAgICAgICAgICAgICBkYXRhID0gbmV3IFVpbnQ4Q2xhbXBlZEFycmF5KGl0ZW0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcbiAgICAgICAgICAgIGNhbnZhcy53aWR0aCA9IHBuZ1dpZHRoO1xuICAgICAgICAgICAgY2FudmFzLmhlaWdodCA9IHBuZ0hlaWdodDtcbiAgICAgICAgICAgIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuICAgICAgICAgICAgc3ByaXRlU2hlZXQgPSBuZXcgUElYSS5CYXNlVGV4dHVyZS5mcm9tKGNhbnZhcyk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGltYWdlRGF0YSA9IGN0eC5jcmVhdGVJbWFnZURhdGEocG5nV2lkdGgscG5nSGVpZ2h0KTtcbiAgICAgICAgICAgIGltYWdlRGF0YS5kYXRhLnNldChkYXRhKTtcbiAgICAgICAgICAgIGN0eC5wdXRJbWFnZURhdGEoaW1hZ2VEYXRhLDAsMCk7XG5cbiAgICAgICAgICAgIG9iai50ZXh0dXJlcy5wdXNoKG5ldyBQSVhJLlRleHR1cmUoc3ByaXRlU2hlZXQsbmV3IFBJWEkuUmVjdGFuZ2xlKDAsIDAsIHBuZ1dpZHRoLCBwbmdIZWlnaHQpKSk7XG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChjYW52YXMpO1xuICAgICAgICByZXR1cm4gb2JqO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIOWwhmdpZue8k+WtmOi1hOa6kOi9rOaNouS4uue6ueeQhuadkOi0qFxuICAgICAqIEBwYXJhbSAge29iamVjdH0gcmVzb3VyY2UgICAg57yT5a2Y6LWE5rqQXG4gICAgICogQHJldHVybiB7b2JqZWN0fSDov5Tlm57kuIDkuKrlr7nosaHvvIzljIXmi6xhcG5n55qE5q+P5bin5pe26ZW/5Y+K6Kej56CB5Ye65p2l5p2Q6LSoXG4gICAgICovXG4gICAgZ2lmUmVzb3VyY2VUb1RleHR1cmVzKHJlc291cmNlKXtcbiAgICAgICAgY29uc3QgX3RzID0gdGhpcztcblxuICAgICAgICBsZXQgb2JqID0ge1xuICAgICAgICAgICAgICAgIGRlbGF5VGltZXM6W10sXG4gICAgICAgICAgICAgICAgdGV4dHVyZXM6W11cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBidWYgPSBuZXcgVWludDhBcnJheShyZXNvdXJjZS5kYXRhKSxcbiAgICAgICAgICAgIGdpZiA9IG5ldyAkb21nZ2lmKGJ1ZiksXG4gICAgICAgICAgICBnaWZXaWR0aCA9IGdpZi53aWR0aCxcbiAgICAgICAgICAgIGdpZkhlaWdodCA9IGdpZi5oZWlnaHQsXG4gICAgICAgICAgICBnaWZGcmFtZXNMZW4gPSBnaWYubnVtRnJhbWVzKCksXG4gICAgICAgICAgICBnaWZGcmFtZUluZm8sXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHNwcml0ZVNoZWV0LFxuICAgICAgICAgICAgY2FudmFzLFxuICAgICAgICAgICAgY3R4LFxuICAgICAgICAgICAgaW1hZ2VEYXRhO1xuICAgICAgICBcbiAgICAgICAgXG5cbiAgICAgICAgZm9yKGxldCBpPTA7IGk8Z2lmRnJhbWVzTGVuOyBpKyspe1xuICAgICAgICAgICAgLy/lvpfliLDmr4/luKfnmoTkv6Hmga/lubblsIbluKflu7bov5/kv6Hmga/kv53lrZjotbfmnaVcbiAgICAgICAgICAgIGdpZkZyYW1lSW5mbyA9IGdpZi5mcmFtZUluZm8oaSk7XG4gICAgICAgICAgICBvYmouZGVsYXlUaW1lcy5wdXNoKGdpZkZyYW1lSW5mby5kZWxheSAqIDEwKTtcblxuICAgICAgICAgICAgY2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XG4gICAgICAgICAgICBjYW52YXMud2lkdGggPSBnaWZXaWR0aDtcbiAgICAgICAgICAgIGNhbnZhcy5oZWlnaHQgPSBnaWZIZWlnaHQ7XG4gICAgICAgICAgICBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcblxuICAgICAgICAgICAgLy/liJvlu7rkuIDlnZfnqbrnmb3nmoRJbWFnZURhdGHlr7nosaFcbiAgICAgICAgICAgIGltYWdlRGF0YSA9IGN0eC5jcmVhdGVJbWFnZURhdGEoZ2lmV2lkdGgsIGdpZkhlaWdodCk7XG5cbiAgICAgICAgICAgIC8v5bCG56ys5LiA5bin6L2s5o2i5Li6UkdCQeWAvO+8jOWwhui1i+S6iOWIsOWbvuWDj+WMulxuICAgICAgICAgICAgZ2lmLmRlY29kZUFuZEJsaXRGcmFtZVJHQkEoaSxpbWFnZURhdGEuZGF0YSk7XG5cbiAgICAgICAgICAgIC8v5bCG5LiK6Z2i5Yib5bu655qE5Zu+5YOP5pWw5o2u5pS+5Zue5Yiw55S76Z2i5LiKXG4gICAgICAgICAgICBjdHgucHV0SW1hZ2VEYXRhKGltYWdlRGF0YSwgMCwgMCk7XG5cbiAgICAgICAgICAgIHNwcml0ZVNoZWV0ID0gbmV3IFBJWEkuQmFzZVRleHR1cmUuZnJvbUNhbnZhcyhjYW52YXMpO1xuICAgICAgICAgICAgb2JqLnRleHR1cmVzLnB1c2gobmV3IFBJWEkuVGV4dHVyZShzcHJpdGVTaGVldCxuZXcgUElYSS5SZWN0YW5nbGUoMCwgMCwgZ2lmV2lkdGgsIGdpZkhlaWdodCkpKTtcbiAgICAgICAgfTtcbiAgICAgICAgLy8gZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChjYW52YXMpO1xuICAgICAgICByZXR1cm4gb2JqO1xuICAgIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgSW1hZ2U7Il0sIm5hbWVzIjpbInBha28iLCIkdXBuZ2pzIiwiJG9tZ2dpZiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7QUFBQSx1QkFBZSxVQUFDLFFBQVE7UUFDcEIsSUFBSSxLQUFLLEdBQUcsUUFBUSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNoQyxPQUFPLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDO0lBQ25DLENBQUMsRUFBQzs7SUNIRjtBQUNBLElBMkJBLG1CQUFtQixHQUFHO1FBQ3BCLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQzs7UUFHVixJQUFJLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxLQUFLLElBQUksSUFBSSxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsS0FBSyxJQUFJLElBQUksR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLEtB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SUFBSSxFQUFFLEdBQUcsR0FBRyxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUM7d0JBQ3BDLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUM7cUJBQ3REO2dCQUNMLElBQUksS0FBSyxJQUFJLENBQUM7b0JBQ1YsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLElBQUksRUFBRSxDQUFDLEVBQUUsRUFBRTt3QkFDM0IsSUFBSSxFQUFFLEdBQUcsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLEVBQ3RELEVBQUUsR0FBRyxDQUFDLEVBQUUsSUFBSSxFQUFFLEdBQUcsRUFBRSxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUM7d0JBQ25DLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUM7cUJBQ3REO2dCQUNMLElBQUksS0FBSyxJQUFJLENBQUM7b0JBQ1YsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLElBQUksRUFBRSxDQUFDLEVBQUUsRUFBRTt3QkFDM0IsSUFBSSxFQUFFLEdBQUcsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLEVBQ3ZELEVBQUUsR0FBRyxDQUFDLEVBQUUsSUFBSSxFQUFFLEdBQUcsRUFBRSxJQUFJLENBQUMsR0FBRyxHQUFHLENB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QUcsQ0FBQyxLQUFLLElBQUksQ0FBQzt3QkFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsRUFBRSxHQUFHLENBQUMsSUFBSSxFQUFFLE1BQU0sR0FBRyxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsSUFBSSxFQUFFLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDOztpQkFFL0c7cUJBQU0sSUFBSSxJQUFJLElBQUksTUFBTTtvQkFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLEdBQUcsQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxHQUFHLE1BQU0sQ0FBQztxQkFDM0UsSUFBSSxJQUFJLElBQUksTUFBTTtvQkFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQztxQkFDbEQsSUFBSSxJQUFJLElBQUksTUFBTSxFQUFFO29CQUNyQixJQUFJLEdBQUcsQ0FBQyxLQUFLLElBQUksQ0FBQyxJQUFJLEdBQUcsQ0FBQyxLQUFLLElBQUksQ0FBQzt3QkFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDO3lCQUN0RSxJQUFJLEdBQUcsQ0FBQyxLQUFLLElBQUksQ0FBQyxJQUFJLEdBQUcsQ0FBQyxLQUFLLElBQUksQ0FBQzt3QkFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsRUFBRSxHQUFHLENBQUMsSUFBSSxFQUFFLE1BQU0sR0FBRyxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsSUFBSSxFQUFFLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO3lCQUN6SCxJQUFJLEdBQUcsQ0FBQyxLQUFLLElBQUksQ0FBQzt3QkFBRSxHQUFHLENB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RUFBRSxHQUFHLENBQUMsQ0FBQyxJQUFJLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLEdBQUcsQ0FBQztvQkFDbEcsSUFBSSxJQUFJLElBQUksQ0FBQzt3QkFDVCxLQUFLLElBQUksQ0FBQyxHQUFHLEdBQUcsRUFBRSxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsRUFBRTs0QkFBRSxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBQyxJQUFJLEdBQUcsQ0FBQztpQkFDM0c7cUJBQU07b0JBQ0gsSUFBSSxJQUFJLElBQUksQ0FBQyxFQUFFO3dCQUNYLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxFQUFFOzRCQUFFLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxJQUFJLEdBQUcsQ0FBQztxQkFDeEY7b0JBRUQsSUFBSSxJQUFJLElBQUksQ0FBQyxFQUFFO3dCQUNYLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxFQUFFOzRCQUFFLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxJQUFJLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLEdBQUcsQ0FBQzt3QkFDNUYsS0FBSyxJQUFJLENBQUMsR0FBRyxHQUFHLEVBQUUsQ0FB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eUJBQU0sSUFBSSxJQUFJLElBQUksQ0FBQyxFQUFFO3dCQUNsQixJQUFJLEVBQUUsR0FBRyxFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUMsRUFDM0IsRUFBRSxHQUFHLEVBQUUsQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLEVBQ2hCLEVBQUUsR0FBRyxFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUUsRUFDcEIsRUFBRSxHQUFHLEVBQUUsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDO3dCQUN6QixJQUFJLEVBQUUsR0FBRyxFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUMsRUFDM0IsRUFBRSxHQUFHLEVBQUUsQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLEVBQ2hCLEVBQUUsR0FBRyxFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUUsRUFDcEIsRUFBRSxHQUFHLEVBQUUsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDO3dCQUV6QixJQUFJLEdBQUcsR0FBRyxDQUFDLEdBQUcsRUFBRSxFQUNaLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEdBQUcsRUFDbEIsR0FBRyxJQUFJLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQzt3QkFDakMsRUFBRSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxHQUFHLEdBQUcsRUFBRSxDQUFDO3dCQUN0QixFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsRUFBRSxHQUFHLEVBQUUsR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDO3dCQUNuQyxFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsRUFBRSxHQUFHLEVBQUUsR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDO3dCQUNu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QUFDLENBQUMsQ0FBQztZQUU1QyxHQUFHLENBQUMsSUFBSSxFQUFFLE1BQU0sRUFBRSxFQUFFLENBQUMsQ0FBQztZQUN0QixNQUFNLElBQUksQ0FBQyxDQUFDO1lBQ1osR0FBRyxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsTUFBTSxDQUFDLENBQUM7WUFDMUIsTUFBTSxJQUFJLENBQUMsQ0FBQztZQUNaLEdBQUcsQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQyxDQUFDO1lBQ3JCLE1BQU0sSUFBSSxDQUFDLENBQUM7WUFDWixHQUFHLENBQUMsSUFBSSxFQUFFLE1BQU0sRUFBRSxDQUFDLENBQUMsQ0FBQztZQUNyQixNQUFNLElBQUksQ0FBQyxDQUFDO1lBQ1osSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUM7WUFDMUIsTUFBTSxFQUFFLENBQUM7WUFDVCxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQztZQUMxQixNQUFNLEVBQUUsQ0FBQztZQUNULElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDakIsTUFBTSxFQUFFLENBQUM7WUFDVCxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ2pCLE1BQU0sRUFBRSxDQUFDO1lBQ1QsSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNqQixNQUFNLEVBQUUsQ0FBQztZQUNULEdBQUcsQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLEdBQUcsQ0FBQyxJQUFJLEVBQUUsTUFBTSxHQUFHLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDO1lBQzlDLE1BQU0sSUFBSSxDQUFDLENBQUM7O1lBRVosR0FBRyxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsQ0FBQyxDQUFDLENBQUM7WUFDckIsTUFBTSxJQUFJLENBQUMsQ0FBQztZQUNaLEdBQUcsQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLE1BQU0sQ0FBQyxDQUFDO1lBQzFCLE1BQU0sSUFBSSxDQUFDLENBQUM7WUFDWixJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ2pCLE1BQU0sRUFBRSxDQUFDO1lBQ1QsR0FBRyxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsR0FBRyxDQUFDLElBQUksRUFBRSxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDNUMsTUFBTSxJQUFJLENBQUMsQ0FBQztZQUNaLElBQUksSUFBSSxFQUFFO2dCQUNOLEdBQUcsQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQyxDQUFDO2dCQUNyQixNQUFNLElBQUksQ0FBQyxDQUFDO2dCQUNaLEdBQUcsQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLE1BQU0sQ0FBQyxDQUFDO2dCQUMxQixNQUFNLElBQUksQ0FBQyxDQUFDO2dCQUNaLEdBQUcsQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUM7Z0JBQ3RDLE1BQU0sSUFBSSxDQUFDLENBQUM7Z0JBQ1osR0FBRyxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsQ0FBQyxDQUFDLENBQUM7Z0JBQ3JCLE1BQU0sSUFBSSxDQUFDLENBQUM7Z0JBQ1osR0FBRyxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsR0FBRyxDQUFDLElBQUksRUFBRSxNQUFNLEdBQUcsRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUM7Z0JBQzlDLE1BQU0sSUFBSSxDQUFDLENBQUM7YUFDZjtZQUVELElBQUksSUFBSSxDQUFDLEtBQUssSUFBSSxDQUFDLEVBQUU7Z0JBQ2pCLElBQUksRUFBRSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDO2dCQUMxQixHQUFHLENBQUMsSUFBSSxFQUFFLE1BQU0sRUFBRSxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUM7Z0JBQzFCLE1BQU0sSUFBSSxDQUFDLENBQUM7Z0JBQ1osR0FBRyxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsTUFB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LENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBQyxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUM7YUFDL0c7aUJBQU07Z0JBQ0gsSUFBSSxJQUFJLElBQUksQ0FBQyxFQUFFO29CQUNYLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxFQUFFO3dCQUFFLElBQUksQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHLENBQUMsSUFBSSxHQUFHLENBQUM7aUJBQzVGO2dCQUNELElBQUksSUFBSSxJQUFJLENBQUMsRUFBRTtvQkFDWCxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsRUFBRTt3QkFBRSxJQUFJLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksR0FBRyxDQUFDO29CQUNoRyxLQUFLLElBQUksQ0FBQyxHQUFHLEdBQUcsRUFBRSxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsRUFBRTt3QkFBRSxJQUFJLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxH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LEdBQUcsQ0FBQyxFQUFFLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUN2QixLQUFLLElBQUksQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLEVBQUU7Z0JBQzdCLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDLEVBQ3ZCLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUMsRUFDM0IsQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUMzQixDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUM7O2dCQUVoQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUNWLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7Z0JBQ1YsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQztnQkFDVixDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUVWLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUNkLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUNkLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUNkLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUNkLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUNkLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUNkLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUNkLENBQUMsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUNmLENBQUMsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUNmLENBQUMsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO2FBQ2xCO1lBQ0QsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNaLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDWixDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ1osQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNiLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDYixDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBRWQsT0FBTztnQkFDSCxDQUFDLEVBQUUsQ0FBQztnQkFDSixDQUFDLEVBQUUsQ0FBQztnQkFDSixDQUFDLEVBQUUsQ0FBQzthQUNQLENBQUM7U0FDTCxDQUFBO1FBQ0QsSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLEdBQUcsVUFBVSxLQUFLO1lBQ2xDLElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQyxDQUFDLEVBQ1gsQ0FBQyxHQUFHLEtBQUssQ0FBQyxDQUFDLEVBQ1gsQ0FBQyxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUM7O1lBR2hCLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFDVCxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUNULEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQ1QsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFDVCxFQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO1lBQzlCLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEVBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsRUFBRSxHQUFH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LENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO2FBQzdPO1lBQ0QsR0FBRyxFQUFFLFVBQVUsQ0FBQyxFQUFFLENBQUM7Z0JBQ2YsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO2FBQ2hFO1lBQ0QsR0FBRyxFQUFFLFVBQVUsQ0FBQyxFQUFFLENBQUM7Z0JBQ2YsT0FBTyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMs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