(function (pako) {
    'use strict';

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

    var app = new PIXI.Application();
    var loader = PIXI.loader, title = document.title, loadOption = {
        loadType: PIXI.loaders.Resource.LOAD_TYPE.XHR,
        xhrType: PIXI.loaders.Resource.XHR_RESPONSE_TYPE.BUFFER,
        crossOrigin: ''
    }, imgs = {
        gif: 'http://isparta.github.io/compare/image/dongtai/gif/1.gif',
        apng: 'http://isparta.github.io/compare/image/dongtai/apng/1.png'
        // gif:'./1.gif',
        // apng:'./1.png'
    };
    loader.add(imgs.gif, loadOption);
    loader.add(imgs.apng, loadOption);
    loader.on('progress', function (loader, resoure) {
        document.title = Math.round(loader.progress);
    }).load(function (progress, resources) {
        document.title = title;
        window.gif = new Image(imgs.gif, resources);
        window.apng = new Image(imgs.apng, resources);
        var gifSprite = window.gif.sprite, apngSprite = window.apng.sprite;
        gifSprite.x = 100;
        apngSprite.x = 450;
        gifSprite.y = 160;
        apngSprite.y = 160;
        app.stage.addChild(gifSprite);
        app.stage.addChild(apngSprite);
    });
    document.body.appendChild(app.view);

}(pako));
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVtby5lczYiLCJzb3VyY2VzIjpbInNyYy9saWIvX2dldEV4ZU5hbWUuZXM2Iiwic3JjL2xpYi9fb21nZ2lmLmVzNiIsInNyYy9saWIvX3VwbmcuZXM2Iiwic3JjL1BpeGlBcG5nQW5kR2lmLmVzNiIsInNyYy9kZW1vLmVzNiJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgZGVmYXVsdCAoZmlsZVBhdGgpPT57XG4gICAgbGV0IGFMaXN0ID0gZmlsZVBhdGguc3BsaXQoJy4nKTtcbiAgICByZXR1cm4gYUxpc3RbYUxpc3QubGVuZ3RoIC0gMV07XG59OyIsIi8vIChjKSBEZWFuIE1jTmFtZWUgPGRlYW5AZ21haWwuY29tPiwgMjAxMy5cbi8vXG4vLyBodHRwczovL2dpdGh1Yi5jb20vZGVhbm0vb21nZ2lmXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGEgY29weVxuLy8gb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGUgXCJTb2Z0d2FyZVwiKSwgdG9cbi8vIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZyB3aXRob3V0IGxpbWl0YXRpb24gdGhlXG4vLyByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLCBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Jcbi8vIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzXG4vLyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlIGZvbGxvd2luZyBjb25kaXRpb25zOlxuLy9cbi8vIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkIGluXG4vLyBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbi8vXG4vLyBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTIE9SXG4vLyBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GIE1FUkNIQU5UQUJJTElUWSxcbi8vIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOIE5PIEVWRU5UIFNIQUxMIFRIRVxuLy8gQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSwgREFNQUdFUyBPUiBPVEhFUlxuLy8gTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUiBPVEhFUldJU0UsIEFSSVNJTkdcbi8vIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRSBVU0UgT1IgT1RIRVIgREVBTElOR1Ncbi8vIElOIFRIRSBTT0ZUV0FSRS5cbi8vXG4vLyBvbWdnaWYgaXMgYSBKYXZhU2NyaXB0IGltcGxlbWVudGF0aW9uIG9mIGEgR0lGIDg5YSBlbmNvZGVyIGFuZCBkZWNvZGVyLFxuLy8gaW5jbHVkaW5nIGFuaW1hdGlvbiBhbmQgY29tcHJlc3Npb24uICBJdCBkb2VzIG5vdCByZWx5IG9uIGFueSBzcGVjaWZpY1xuLy8gdW5kZXJseWluZyBzeXN0ZW0sIHNvIHNob3VsZCBydW4gaW4gdGhlIGJyb3dzZXIsIE5vZGUsIG9yIFBsYXNrLlxuXG5cInVzZSBzdHJpY3RcIjtcblxuZnVuY3Rpb24gR2lmUmVhZGVyKGJ1Zikge1xuICB2YXIgcCA9IDA7XG5cbiAgLy8gLSBIZWFkZXIgKEdJRjg3YSBvciBHSUY4OWEpLlxuICBpZiAoYnVmW3ArK10gIT09IDB4NDcgfHwgYnVmW3ArK10gIT09IDB4NDkgfHwgYnVmW3ArK10gIT09IDB4NDYgfHxcbiAgICBidWZbcCsrXSAhPT0gMHgzOCB8fCAoYnVmW3ArK10gKyAxICYgMHhmZCkgIT09IDB4MzggfHwgYnVmW3ArK10gIT09IDB4NjEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIEdJRiA4N2EvODlhIGhlYWRlci5cIik7XG4gIH1cblxuICAvLyAtIExvZ2ljYWwgU2NyZWVuIERlc2NyaXB0b3IuXG4gIHZhciB3aWR0aCA9IGJ1ZltwKytdIHwgYnVmW3ArK10gPDwgODtcbiAgdmFyIGhlaWdodCA9IGJ1ZltwKytdIHwgYnVmW3ArK10gPDwgODtcbiAgdmFyIHBmMCA9IGJ1ZltwKytdOyAvLyA8UGFja2VkIEZpZWxkcz4uXG4gIHZhciBnbG9iYWxfcGFsZXR0ZV9mbGFnID0gcGYwID4+IDc7XG4gIHZhciBudW1fZ2xvYmFsX2NvbG9yc19wb3cyID0gcGYwICYgMHg3O1xuICB2YXIgbnVtX2dsb2JhbF9jb2xvcnMgPSAxIDw8IChudW1fZ2xvYmFsX2NvbG9yc19wb3cyICsgMSk7XG4gIHZhciBiYWNrZ3JvdW5kID0gYnVmW3ArK107XG4gIGJ1ZltwKytdOyAvLyBQaXhlbCBhc3BlY3QgcmF0aW8gKHVudXNlZD8pLlxuXG4gIHZhciBnbG9iYWxfcGFsZXR0ZV9vZmZzZXQgPSBudWxsO1xuICB2YXIgZ2xvYmFsX3BhbGV0dGVfc2l6ZSA9IG51bGw7XG5cbiAgaWYgKGdsb2JhbF9wYWxldHRlX2ZsYWcpIHtcbiAgICBnbG9iYWxfcGFsZXR0ZV9vZmZzZXQgPSBwO1xuICAgIGdsb2JhbF9wYWxldHRlX3NpemUgPSBudW1fZ2xvYmFsX2NvbG9ycztcbiAgICBwICs9IG51bV9nbG9iYWxfY29sb3JzICogMzsgLy8gU2VlayBwYXN0IHBhbGV0dGUuXG4gIH1cblxuICB2YXIgbm9fZW9mID0gdHJ1ZTtcblxuICB2YXIgZnJhbWVzID0gW107XG5cbiAgdmFyIGRlbGF5ID0gMDtcbiAgdmFyIHRyYW5zcGFyZW50X2luZGV4ID0gbnVsbDtcbiAgdmFyIGRpc3Bvc2FsID0gMDsgLy8gMCAtIE5vIGRpc3Bvc2FsIHNwZWNpZmllZC5cbiAgdmFyIGxvb3BfY291bnQgPSBudWxsO1xuXG4gIHRoaXMud2lkdGggPSB3aWR0aDtcbiAgdGhpcy5oZWlnaHQgPSBoZWlnaHQ7XG5cbiAgd2hpbGUgKG5vX2VvZiAmJiBwIDwgYnVmLmxlbmd0aCkge1xuICAgIHN3aXRjaCAoYnVmW3ArK10pIHtcbiAgICAgIGNhc2UgMHgyMTogLy8gR3JhcGhpY3MgQ29udHJvbCBFeHRlbnNpb24gQmxvY2tcbiAgICAgICAgc3dpdGNoIChidWZbcCsrXSkge1xuICAgICAgICAgIGNhc2UgMHhmZjogLy8gQXBwbGljYXRpb24gc3BlY2lmaWMgYmxvY2tcbiAgICAgICAgICAgIC8vIFRyeSBpZiBpdCdzIGEgTmV0c2NhcGUgYmxvY2sgKHdpdGggYW5pbWF0aW9uIGxvb3AgY291bnRlcikuXG4gICAgICAgICAgICBpZiAoYnVmW3BdICE9PSAweDBiIHx8IC8vIDIxIEZGIGFscmVhZHkgcmVhZCwgY2hlY2sgYmxvY2sgc2l6ZS5cbiAgICAgICAgICAgICAgLy8gTkVUU0NBUEUyLjBcbiAgICAgICAgICAgICAgYnVmW3AgKyAxXSA9PSAweDRlICYmIGJ1ZltwICsgMl0gPT0gMHg0NSAmJiBidWZbcCArIDNdID09IDB4NTQgJiZcbiAgICAgICAgICAgICAgYnVmW3AgKyA0XSA9PSAweDUzICYmIGJ1ZltwICsgNV0gPT0gMHg0MyAmJiBidWZbcCArIDZdID09IDB4NDEgJiZcbiAgICAgICAgICAgICAgYnVmW3AgKyA3XSA9PSAweDUwICYmIGJ1ZltwICsgOF0gPT0gMHg0NSAmJiBidWZbcCArIDldID09IDB4MzIgJiZcbiAgICAgICAgICAgICAgYnVmW3AgKyAxMF0gPT0gMHgyZSAmJiBidWZbcCArIDExXSA9PSAweDMwICYmXG4gICAgICAgICAgICAgIC8vIFN1Yi1ibG9ja1xuICAgICAgICAgICAgICBidWZbcCArIDEyXSA9PSAweDAzICYmIGJ1ZltwICsgMTNdID09IDB4MDEgJiYgYnVmW3AgKyAxNl0gPT0gMCkge1xuICAgICAgICAgICAgICBwICs9IDE0O1xuICAgICAgICAgICAgICBsb29wX2NvdW50ID0gYnVmW3ArK10gfCBidWZbcCsrXSA8PCA4O1xuICAgICAgICAgICAgICBwKys7IC8vIFNraXAgdGVybWluYXRvci5cbiAgICAgICAgICAgIH0gZWxzZSB7IC8vIFdlIGRvbid0IGtub3cgd2hhdCBpdCBpcywganVzdCB0cnkgdG8gZ2V0IHBhc3QgaXQuXG4gICAgICAgICAgICAgIHAgKz0gMTI7XG4gICAgICAgICAgICAgIHdoaWxlICh0cnVlKSB7IC8vIFNlZWsgdGhyb3VnaCBzdWJibG9ja3MuXG4gICAgICAgICAgICAgICAgdmFyIGJsb2NrX3NpemUgPSBidWZbcCsrXTtcbiAgICAgICAgICAgICAgICAvLyBCYWQgYmxvY2sgc2l6ZSAoZXg6IHVuZGVmaW5lZCBmcm9tIGFuIG91dCBvZiBib3VuZHMgcmVhZCkuXG4gICAgICAgICAgICAgICAgaWYgKCEoYmxvY2tfc2l6ZSA+PSAwKSkgdGhyb3cgRXJyb3IoXCJJbnZhbGlkIGJsb2NrIHNpemVcIik7XG4gICAgICAgICAgICAgICAgaWYgKGJsb2NrX3NpemUgPT09IDApIGJyZWFrOyAvLyAwIHNpemUgaXMgdGVybWluYXRvclxuICAgICAgICAgICAgICAgIHAgKz0gYmxvY2tfc2l6ZTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICBjYXNlIDB4Zjk6IC8vIEdyYXBoaWNzIENvbnRyb2wgRXh0ZW5zaW9uXG4gICAgICAgICAgICBpZiAoYnVmW3ArK10gIT09IDB4NCB8fCBidWZbcCArIDRdICE9PSAwKVxuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIGdyYXBoaWNzIGV4dGVuc2lvbiBibG9jay5cIik7XG4gICAgICAgICAgICB2YXIgcGYxID0gYnVmW3ArK107XG4gICAgICAgICAgICBkZWxheSA9IGJ1ZltwKytdIHwgYnVmW3ArK10gPDwgODtcbiAgICAgICAgICAgIHRyYW5zcGFyZW50X2luZGV4ID0gYnVmW3ArK107XG4gICAgICAgICAgICBpZiAoKHBmMSAmIDEpID09PSAwKSB0cmFuc3BhcmVudF9pbmRleCA9IG51bGw7XG4gICAgICAgICAgICBkaXNwb3NhbCA9IHBmMSA+PiAyICYgMHg3O1xuICAgICAgICAgICAgcCsrOyAvLyBTa2lwIHRlcm1pbmF0b3IuXG4gICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgIGNhc2UgMHhmZTogLy8gQ29tbWVudCBFeHRlbnNpb24uXG4gICAgICAgICAgICB3aGlsZSAodHJ1ZSkgeyAvLyBTZWVrIHRocm91Z2ggc3ViYmxvY2tzLlxuICAgICAgICAgICAgICB2YXIgYmxvY2tfc2l6ZSA9IGJ1ZltwKytdO1xuICAgICAgICAgICAgICAvLyBCYWQgYmxvY2sgc2l6ZSAoZXg6IHVuZGVmaW5lZCBmcm9tIGFuIG91dCBvZiBib3VuZHMgcmVhZCkuXG4gICAgICAgICAgICAgIGlmICghKGJsb2NrX3NpemUgPj0gMCkpIHRocm93IEVycm9yKFwiSW52YWxpZCBibG9jayBzaXplXCIpO1xuICAgICAgICAgICAgICBpZiAoYmxvY2tfc2l6ZSA9PT0gMCkgYnJlYWs7IC8vIDAgc2l6ZSBpcyB0ZXJtaW5hdG9yXG4gICAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKGJ1Zi5zbGljZShwLCBwK2Jsb2NrX3NpemUpLnRvU3RyaW5nKCdhc2NpaScpKTtcbiAgICAgICAgICAgICAgcCArPSBibG9ja19zaXplO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICAgICBcIlVua25vd24gZ3JhcGhpYyBjb250cm9sIGxhYmVsOiAweFwiICsgYnVmW3AgLSAxXS50b1N0cmluZygxNikpO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBjYXNlIDB4MmM6IC8vIEltYWdlIERlc2NyaXB0b3IuXG4gICAgICAgIHZhciB4ID0gYnVmW3ArK10gfCBidWZbcCsrXSA8PCA4O1xuICAgICAgICB2YXIgeSA9IGJ1ZltwKytdIHwgYnVmW3ArK10gPDwgODtcbiAgICAgICAgdmFyIHcgPSBidWZbcCsrXSB8IGJ1ZltwKytdIDw8IDg7XG4gICAgICAgIHZhciBoID0gYnVmW3ArK10gfCBidWZbcCsrXSA8PCA4O1xuICAgICAgICB2YXIgcGYyID0gYnVmW3ArK107XG4gICAgICAgIHZhciBsb2NhbF9wYWxldHRlX2ZsYWcgPSBwZjIgPj4gNztcbiAgICAgICAgdmFyIGludGVybGFjZV9mbGFnID0gcGYyID4+IDYgJiAxO1xuICAgICAgICB2YXIgbnVtX2xvY2FsX2NvbG9yc19wb3cyID0gcGYyICYgMHg3O1xuICAgICAgICB2YXIgbnVtX2xvY2FsX2NvbG9ycyA9IDEgPDwgKG51bV9sb2NhbF9jb2xvcnNfcG93MiArIDEpO1xuICAgICAgICB2YXIgcGFsZXR0ZV9vZmZzZXQgPSBnbG9iYWxfcGFsZXR0ZV9vZmZzZXQ7XG4gICAgICAgIHZhciBwYWxldHRlX3NpemUgPSBnbG9iYWxfcGFsZXR0ZV9zaXplO1xuICAgICAgICB2YXIgaGFzX2xvY2FsX3BhbGV0dGUgPSBmYWxzZTtcbiAgICAgICAgaWYgKGxvY2FsX3BhbGV0dGVfZmxhZykge1xuICAgICAgICAgIHZhciBoYXNfbG9jYWxfcGFsZXR0ZSA9IHRydWU7XG4gICAgICAgICAgcGFsZXR0ZV9vZmZzZXQgPSBwOyAvLyBPdmVycmlkZSB3aXRoIGxvY2FsIHBhbGV0dGUuXG4gICAgICAgICAgcGFsZXR0ZV9zaXplID0gbnVtX2xvY2FsX2NvbG9ycztcbiAgICAgICAgICBwICs9IG51bV9sb2NhbF9jb2xvcnMgKiAzOyAvLyBTZWVrIHBhc3QgcGFsZXR0ZS5cbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBkYXRhX29mZnNldCA9IHA7XG5cbiAgICAgICAgcCsrOyAvLyBjb2Rlc2l6ZVxuICAgICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICAgIHZhciBibG9ja19zaXplID0gYnVmW3ArK107XG4gICAgICAgICAgLy8gQmFkIGJsb2NrIHNpemUgKGV4OiB1bmRlZmluZWQgZnJvbSBhbiBvdXQgb2YgYm91bmRzIHJlYWQpLlxuICAgICAgICAgIGlmICghKGJsb2NrX3NpemUgPj0gMCkpIHRocm93IEVycm9yKFwiSW52YWxpZCBibG9jayBzaXplXCIpO1xuICAgICAgICAgIGlmIChibG9ja19zaXplID09PSAwKSBicmVhazsgLy8gMCBzaXplIGlzIHRlcm1pbmF0b3JcbiAgICAgICAgICBwICs9IGJsb2NrX3NpemU7XG4gICAgICAgIH1cblxuICAgICAgICBmcmFtZXMucHVzaCh7XG4gICAgICAgICAgeDogeCxcbiAgICAgICAgICB5OiB5LFxuICAgICAgICAgIHdpZHRoOiB3LFxuICAgICAgICAgIGhlaWdodDogaCxcbiAgICAgICAgICBoYXNfbG9jYWxfcGFsZXR0ZTogaGFzX2xvY2FsX3BhbGV0dGUsXG4gICAgICAgICAgcGFsZXR0ZV9vZmZzZXQ6IHBhbGV0dGVfb2Zmc2V0LFxuICAgICAgICAgIHBhbGV0dGVfc2l6ZTogcGFsZXR0ZV9zaXplLFxuICAgICAgICAgIGRhdGFfb2Zmc2V0OiBkYXRhX29mZnNldCxcbiAgICAgICAgICBkYXRhX2xlbmd0aDogcCAtIGRhdGFfb2Zmc2V0LFxuICAgICAgICAgIHRyYW5zcGFyZW50X2luZGV4OiB0cmFuc3BhcmVudF9pbmRleCxcbiAgICAgICAgICBpbnRlcmxhY2VkOiAhIWludGVybGFjZV9mbGFnLFxuICAgICAgICAgIGRlbGF5OiBkZWxheSxcbiAgICAgICAgICBkaXNwb3NhbDogZGlzcG9zYWxcbiAgICAgICAgfSk7XG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBjYXNlIDB4M2I6IC8vIFRyYWlsZXIgTWFya2VyIChlbmQgb2YgZmlsZSkuXG4gICAgICAgIG5vX2VvZiA9IGZhbHNlO1xuICAgICAgICBicmVhaztcblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVW5rbm93biBnaWYgYmxvY2s6IDB4XCIgKyBidWZbcCAtIDFdLnRvU3RyaW5nKDE2KSk7XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIHRoaXMubnVtRnJhbWVzID0gZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiBmcmFtZXMubGVuZ3RoO1xuICB9O1xuXG4gIHRoaXMubG9vcENvdW50ID0gZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiBsb29wX2NvdW50O1xuICB9O1xuXG4gIHRoaXMuZnJhbWVJbmZvID0gZnVuY3Rpb24gKGZyYW1lX251bSkge1xuICAgIGlmIChmcmFtZV9udW0gPCAwIHx8IGZyYW1lX251bSA+PSBmcmFtZXMubGVuZ3RoKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRnJhbWUgaW5kZXggb3V0IG9mIHJhbmdlLlwiKTtcbiAgICByZXR1cm4gZnJhbWVzW2ZyYW1lX251bV07XG4gIH1cblxuICB0aGlzLmRlY29kZUFuZEJsaXRGcmFtZUJHUkEgPSBmdW5jdGlvbiAoZnJhbWVfbnVtLCBwaXhlbHMpIHtcbiAgICB2YXIgZnJhbWUgPSB0aGlzLmZyYW1lSW5mbyhmcmFtZV9udW0pO1xuICAgIHZhciBudW1fcGl4ZWxzID0gZnJhbWUud2lkdGggKiBmcmFtZS5oZWlnaHQ7XG4gICAgdmFyIGluZGV4X3N0cmVhbSA9IG5ldyBVaW50OEFycmF5KG51bV9waXhlbHMpOyAvLyBBdCBtb3N0IDgtYml0IGluZGljZXMuXG4gICAgR2lmUmVhZGVyTFpXT3V0cHV0SW5kZXhTdHJlYW0oXG4gICAgICBidWYsIGZyYW1lLmRhdGFfb2Zmc2V0LCBpbmRleF9zdHJlYW0sIG51bV9waXhlbHMpO1xuICAgIHZhciBwYWxldHRlX29mZnNldCA9IGZyYW1lLnBhbGV0dGVfb2Zmc2V0O1xuXG4gICAgLy8gTk9URShkZWFubSk6IEl0IHNlZW1zIHRvIGJlIG11Y2ggZmFzdGVyIHRvIGNvbXBhcmUgaW5kZXggdG8gMjU2IHRoYW5cbiAgICAvLyB0byA9PT0gbnVsbC4gIE5vdCBzdXJlIHdoeSwgYnV0IENvbXBhcmVTdHViX0VRX1NUUklDVCBzaG93cyB1cCBoaWdoIGluXG4gICAgLy8gdGhlIHByb2ZpbGUsIG5vdCBzdXJlIGlmIGl0J3MgcmVsYXRlZCB0byB1c2luZyBhIFVpbnQ4QXJyYXkuXG4gICAgdmFyIHRyYW5zID0gZnJhbWUudHJhbnNwYXJlbnRfaW5kZXg7XG4gICAgaWYgKHRyYW5zID09PSBudWxsKSB0cmFucyA9IDI1NjtcblxuICAgIC8vIFdlIGFyZSBwb3NzaWJseSBqdXN0IGJsaXR0aW5nIHRvIGEgcG9ydGlvbiBvZiB0aGUgZW50aXJlIGZyYW1lLlxuICAgIC8vIFRoYXQgaXMgYSBzdWJyZWN0IHdpdGhpbiB0aGUgZnJhbWVyZWN0LCBzbyB0aGUgYWRkaXRpb25hbCBwaXhlbHNcbiAgICAvLyBtdXN0IGJlIHNraXBwZWQgb3ZlciBhZnRlciB3ZSBmaW5pc2hlZCBhIHNjYW5saW5lLlxuICAgIHZhciBmcmFtZXdpZHRoID0gZnJhbWUud2lkdGg7XG4gICAgdmFyIGZyYW1lc3RyaWRlID0gd2lkdGggLSBmcmFtZXdpZHRoO1xuICAgIHZhciB4bGVmdCA9IGZyYW1ld2lkdGg7IC8vIE51bWJlciBvZiBzdWJyZWN0IHBpeGVscyBsZWZ0IGluIHNjYW5saW5lLlxuXG4gICAgLy8gT3V0cHV0IGluZGljaWVzIG9mIHRoZSB0b3AgbGVmdCBhbmQgYm90dG9tIHJpZ2h0IGNvcm5lcnMgb2YgdGhlIHN1YnJlY3QuXG4gICAgdmFyIG9wYmVnID0gKChmcmFtZS55ICogd2lkdGgpICsgZnJhbWUueCkgKiA0O1xuICAgIHZhciBvcGVuZCA9ICgoZnJhbWUueSArIGZyYW1lLmhlaWdodCkgKiB3aWR0aCArIGZyYW1lLngpICogNDtcbiAgICB2YXIgb3AgPSBvcGJlZztcblxuICAgIHZhciBzY2Fuc3RyaWRlID0gZnJhbWVzdHJpZGUgKiA0O1xuXG4gICAgLy8gVXNlIHNjYW5zdHJpZGUgdG8gc2tpcCBwYXN0IHRoZSByb3dzIHdoZW4gaW50ZXJsYWNpbmcuICBUaGlzIGlzIHNraXBwaW5nXG4gICAgLy8gNyByb3dzIGZvciB0aGUgZmlyc3QgdHdvIHBhc3NlcywgdGhlbiAzIHRoZW4gMS5cbiAgICBpZiAoZnJhbWUuaW50ZXJsYWNlZCA9PT0gdHJ1ZSkge1xuICAgICAgc2NhbnN0cmlkZSArPSB3aWR0aCAqIDQgKiA3OyAvLyBQYXNzIDEuXG4gICAgfVxuXG4gICAgdmFyIGludGVybGFjZXNraXAgPSA4OyAvLyBUcmFja2luZyB0aGUgcm93IGludGVydmFsIGluIHRoZSBjdXJyZW50IHBhc3MuXG5cbiAgICBmb3IgKHZhciBpID0gMCwgaWwgPSBpbmRleF9zdHJlYW0ubGVuZ3RoOyBpIDwgaWw7ICsraSkge1xuICAgICAgdmFyIGluZGV4ID0gaW5kZXhfc3RyZWFtW2ldO1xuXG4gICAgICBpZiAoeGxlZnQgPT09IDApIHsgLy8gQmVnaW5uaW5nIG9mIG5ldyBzY2FuIGxpbmVcbiAgICAgICAgb3AgKz0gc2NhbnN0cmlkZTtcbiAgICAgICAgeGxlZnQgPSBmcmFtZXdpZHRoO1xuICAgICAgICBpZiAob3AgPj0gb3BlbmQpIHsgLy8gQ2F0Y2ggdGhlIHdyYXAgdG8gc3dpdGNoIHBhc3NlcyB3aGVuIGludGVybGFjaW5nLlxuICAgICAgICAgIHNjYW5zdHJpZGUgPSBmcmFtZXN0cmlkZSAqIDQgKyB3aWR0aCAqIDQgKiAoaW50ZXJsYWNlc2tpcCAtIDEpO1xuICAgICAgICAgIC8vIGludGVybGFjZXNraXAgLyAyICogNCBpcyBpbnRlcmxhY2Vza2lwIDw8IDEuXG4gICAgICAgICAgb3AgPSBvcGJlZyArIChmcmFtZXdpZHRoICsgZnJhbWVzdHJpZGUpICogKGludGVybGFjZXNraXAgPDwgMSk7XG4gICAgICAgICAgaW50ZXJsYWNlc2tpcCA+Pj0gMTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoaW5kZXggPT09IHRyYW5zKSB7XG4gICAgICAgIG9wICs9IDQ7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB2YXIgciA9IGJ1ZltwYWxldHRlX29mZnNldCArIGluZGV4ICogM107XG4gICAgICAgIHZhciBnID0gYnVmW3BhbGV0dGVfb2Zmc2V0ICsgaW5kZXggKiAzICsgMV07XG4gICAgICAgIHZhciBiID0gYnVmW3BhbGV0dGVfb2Zmc2V0ICsgaW5kZXggKiAzICsgMl07XG4gICAgICAgIHBpeGVsc1tvcCsrXSA9IGI7XG4gICAgICAgIHBpeGVsc1tvcCsrXSA9IGc7XG4gICAgICAgIHBpeGVsc1tvcCsrXSA9IHI7XG4gICAgICAgIHBpeGVsc1tvcCsrXSA9IDI1NTtcbiAgICAgIH1cbiAgICAgIC0teGxlZnQ7XG4gICAgfVxuICB9O1xuXG4gIC8vIEkgd2lsbCBnbyB0byBjb3B5IGFuZCBwYXN0ZSBoZWxsIG9uZSBkYXkuLi5cbiAgdGhpcy5kZWNvZGVBbmRCbGl0RnJhbWVSR0JBID0gZnVuY3Rpb24gKGZyYW1lX251bSwgcGl4ZWxzKSB7XG4gICAgdmFyIGZyYW1lID0gdGhpcy5mcmFtZUluZm8oZnJhbWVfbnVtKTtcbiAgICB2YXIgbnVtX3BpeGVscyA9IGZyYW1lLndpZHRoICogZnJhbWUuaGVpZ2h0O1xuICAgIHZhciBpbmRleF9zdHJlYW0gPSBuZXcgVWludDhBcnJheShudW1fcGl4ZWxzKTsgLy8gQXQgbW9zdCA4LWJpdCBpbmRpY2VzLlxuICAgIEdpZlJlYWRlckxaV091dHB1dEluZGV4U3RyZWFtKFxuICAgICAgYnVmLCBmcmFtZS5kYXRhX29mZnNldCwgaW5kZXhfc3RyZWFtLCBudW1fcGl4ZWxzKTtcbiAgICB2YXIgcGFsZXR0ZV9vZmZzZXQgPSBmcmFtZS5wYWxldHRlX29mZnNldDtcblxuICAgIC8vIE5PVEUoZGVhbm0pOiBJdCBzZWVtcyB0byBiZSBtdWNoIGZhc3RlciB0byBjb21wYXJlIGluZGV4IHRvIDI1NiB0aGFuXG4gICAgLy8gdG8gPT09IG51bGwuICBOb3Qgc3VyZSB3aHksIGJ1dCBDb21wYXJlU3R1Yl9FUV9TVFJJQ1Qgc2hvd3MgdXAgaGlnaCBpblxuICAgIC8vIHRoZSBwcm9maWxlLCBub3Qgc3VyZSBpZiBpdCdzIHJlbGF0ZWQgdG8gdXNpbmcgYSBVaW50OEFycmF5LlxuICAgIHZhciB0cmFucyA9IGZyYW1lLnRyYW5zcGFyZW50X2luZGV4O1xuICAgIGlmICh0cmFucyA9PT0gbnVsbCkgdHJhbnMgPSAyNTY7XG5cbiAgICAvLyBXZSBhcmUgcG9zc2libHkganVzdCBibGl0dGluZyB0byBhIHBvcnRpb24gb2YgdGhlIGVudGlyZSBmcmFtZS5cbiAgICAvLyBUaGF0IGlzIGEgc3VicmVjdCB3aXRoaW4gdGhlIGZyYW1lcmVjdCwgc28gdGhlIGFkZGl0aW9uYWwgcGl4ZWxzXG4gICAgLy8gbXVzdCBiZSBza2lwcGVkIG92ZXIgYWZ0ZXIgd2UgZmluaXNoZWQgYSBzY2FubGluZS5cbiAgICB2YXIgZnJhbWV3aWR0aCA9IGZyYW1lLndpZHRoO1xuICAgIHZhciBmcmFtZXN0cmlkZSA9IHdpZHRoIC0gZnJhbWV3aWR0aDtcbiAgICB2YXIgeGxlZnQgPSBmcmFtZXdpZHRoOyAvLyBOdW1iZXIgb2Ygc3VicmVjdCBwaXhlbHMgbGVmdCBpbiBzY2FubGluZS5cblxuICAgIC8vIE91dHB1dCBpbmRpY2llcyBvZiB0aGUgdG9wIGxlZnQgYW5kIGJvdHRvbSByaWdodCBjb3JuZXJzIG9mIHRoZSBzdWJyZWN0LlxuICAgIHZhciBvcGJlZyA9ICgoZnJhbWUueSAqIHdpZHRoKSArIGZyYW1lLngpICogNDtcbiAgICB2YXIgb3BlbmQgPSAoKGZyYW1lLnkgKyBmcmFtZS5oZWlnaHQpICogd2lkdGggKyBmcmFtZS54KSAqIDQ7XG4gICAgdmFyIG9wID0gb3BiZWc7XG5cbiAgICB2YXIgc2NhbnN0cmlkZSA9IGZyYW1lc3RyaWRlICogNDtcblxuICAgIC8vIFVzZSBzY2Fuc3RyaWRlIHRvIHNraXAgcGFzdCB0aGUgcm93cyB3aGVuIGludGVybGFjaW5nLiAgVGhpcyBpcyBza2lwcGluZ1xuICAgIC8vIDcgcm93cyBmb3IgdGhlIGZpcnN0IHR3byBwYXNzZXMsIHRoZW4gMyB0aGVuIDEuXG4gICAgaWYgKGZyYW1lLmludGVybGFjZWQgPT09IHRydWUpIHtcbiAgICAgIHNjYW5zdHJpZGUgKz0gd2lkdGggKiA0ICogNzsgLy8gUGFzcyAxLlxuICAgIH1cblxuICAgIHZhciBpbnRlcmxhY2Vza2lwID0gODsgLy8gVHJhY2tpbmcgdGhlIHJvdyBpbnRlcnZhbCBpbiB0aGUgY3VycmVudCBwYXNzLlxuXG4gICAgZm9yICh2YXIgaSA9IDAsIGlsID0gaW5kZXhfc3RyZWFtLmxlbmd0aDsgaSA8IGlsOyArK2kpIHtcbiAgICAgIHZhciBpbmRleCA9IGluZGV4X3N0cmVhbVtpXTtcblxuICAgICAgaWYgKHhsZWZ0ID09PSAwKSB7IC8vIEJlZ2lubmluZyBvZiBuZXcgc2NhbiBsaW5lXG4gICAgICAgIG9wICs9IHNjYW5zdHJpZGU7XG4gICAgICAgIHhsZWZ0ID0gZnJhbWV3aWR0aDtcbiAgICAgICAgaWYgKG9wID49IG9wZW5kKSB7IC8vIENhdGNoIHRoZSB3cmFwIHRvIHN3aXRjaCBwYXNzZXMgd2hlbiBpbnRlcmxhY2luZy5cbiAgICAgICAgICBzY2Fuc3RyaWRlID0gZnJhbWVzdHJpZGUgKiA0ICsgd2lkdGggKiA0ICogKGludGVybGFjZXNraXAgLSAxKTtcbiAgICAgICAgICAvLyBpbnRlcmxhY2Vza2lwIC8gMiAqIDQgaXMgaW50ZXJsYWNlc2tpcCA8PCAxLlxuICAgICAgICAgIG9wID0gb3BiZWcgKyAoZnJhbWV3aWR0aCArIGZyYW1lc3RyaWRlKSAqIChpbnRlcmxhY2Vza2lwIDw8IDEpO1xuICAgICAgICAgIGludGVybGFjZXNraXAgPj49IDE7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGluZGV4ID09PSB0cmFucykge1xuICAgICAgICBvcCArPSA0O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIHIgPSBidWZbcGFsZXR0ZV9vZmZzZXQgKyBpbmRleCAqIDNdO1xuICAgICAgICB2YXIgZyA9IGJ1ZltwYWxldHRlX29mZnNldCArIGluZGV4ICogMyArIDFdO1xuICAgICAgICB2YXIgYiA9IGJ1ZltwYWxldHRlX29mZnNldCArIGluZGV4ICogMyArIDJdO1xuICAgICAgICBwaXhlbHNbb3ArK10gPSByO1xuICAgICAgICBwaXhlbHNbb3ArK10gPSBnO1xuICAgICAgICBwaXhlbHNbb3ArK10gPSBiO1xuICAgICAgICBwaXhlbHNbb3ArK10gPSAyNTU7XG4gICAgICB9XG4gICAgICAtLXhsZWZ0O1xuICAgIH1cbiAgfTtcbn1cblxuZnVuY3Rpb24gR2lmUmVhZGVyTFpXT3V0cHV0SW5kZXhTdHJlYW0oY29kZV9zdHJlYW0sIHAsIG91dHB1dCwgb3V0cHV0X2xlbmd0aCkge1xuICB2YXIgbWluX2NvZGVfc2l6ZSA9IGNvZGVfc3RyZWFtW3ArK107XG5cbiAgdmFyIGNsZWFyX2NvZGUgPSAxIDw8IG1pbl9jb2RlX3NpemU7XG4gIHZhciBlb2lfY29kZSA9IGNsZWFyX2NvZGUgKyAxO1xuICB2YXIgbmV4dF9jb2RlID0gZW9pX2NvZGUgKyAxO1xuXG4gIHZhciBjdXJfY29kZV9zaXplID0gbWluX2NvZGVfc2l6ZSArIDE7IC8vIE51bWJlciBvZiBiaXRzIHBlciBjb2RlLlxuICAvLyBOT1RFOiBUaGlzIHNoYXJlcyB0aGUgc2FtZSBuYW1lIGFzIHRoZSBlbmNvZGVyLCBidXQgaGFzIGEgZGlmZmVyZW50XG4gIC8vIG1lYW5pbmcgaGVyZS4gIEhlcmUgdGhpcyBtYXNrcyBlYWNoIGNvZGUgY29taW5nIGZyb20gdGhlIGNvZGUgc3RyZWFtLlxuICB2YXIgY29kZV9tYXNrID0gKDEgPDwgY3VyX2NvZGVfc2l6ZSkgLSAxO1xuICB2YXIgY3VyX3NoaWZ0ID0gMDtcbiAgdmFyIGN1ciA9IDA7XG5cbiAgdmFyIG9wID0gMDsgLy8gT3V0cHV0IHBvaW50ZXIuXG5cbiAgdmFyIHN1YmJsb2NrX3NpemUgPSBjb2RlX3N0cmVhbVtwKytdO1xuXG4gIC8vIFRPRE8oZGVhbm0pOiBXb3VsZCB1c2luZyBhIFR5cGVkQXJyYXkgYmUgYW55IGZhc3Rlcj8gIEF0IGxlYXN0IGl0IHdvdWxkXG4gIC8vIHNvbHZlIHRoZSBmYXN0IG1vZGUgLyBiYWNraW5nIHN0b3JlIHVuY2VydGFpbnR5LlxuICAvLyB2YXIgY29kZV90YWJsZSA9IEFycmF5KDQwOTYpO1xuICB2YXIgY29kZV90YWJsZSA9IG5ldyBJbnQzMkFycmF5KDQwOTYpOyAvLyBDYW4gYmUgc2lnbmVkLCB3ZSBvbmx5IHVzZSAyMCBiaXRzLlxuXG4gIHZhciBwcmV2X2NvZGUgPSBudWxsOyAvLyBUcmFjayBjb2RlLTEuXG5cbiAgd2hpbGUgKHRydWUpIHtcbiAgICAvLyBSZWFkIHVwIHRvIHR3byBieXRlcywgbWFraW5nIHN1cmUgd2UgYWx3YXlzIDEyLWJpdHMgZm9yIG1heCBzaXplZCBjb2RlLlxuICAgIHdoaWxlIChjdXJfc2hpZnQgPCAxNikge1xuICAgICAgaWYgKHN1YmJsb2NrX3NpemUgPT09IDApIGJyZWFrOyAvLyBObyBtb3JlIGRhdGEgdG8gYmUgcmVhZC5cblxuICAgICAgY3VyIHw9IGNvZGVfc3RyZWFtW3ArK10gPDwgY3VyX3NoaWZ0O1xuICAgICAgY3VyX3NoaWZ0ICs9IDg7XG5cbiAgICAgIGlmIChzdWJibG9ja19zaXplID09PSAxKSB7IC8vIE5ldmVyIGxldCBpdCBnZXQgdG8gMCB0byBob2xkIGxvZ2ljIGFib3ZlLlxuICAgICAgICBzdWJibG9ja19zaXplID0gY29kZV9zdHJlYW1bcCsrXTsgLy8gTmV4dCBzdWJibG9jay5cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC0tc3ViYmxvY2tfc2l6ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBUT0RPKGRlYW5tKTogV2Ugc2hvdWxkIG5ldmVyIHJlYWxseSBnZXQgaGVyZSwgd2Ugc2hvdWxkIGhhdmUgcmVjZWl2ZWRcbiAgICAvLyBhbmQgRU9JLlxuICAgIGlmIChjdXJfc2hpZnQgPCBjdXJfY29kZV9zaXplKVxuICAgICAgYnJlYWs7XG5cbiAgICB2YXIgY29kZSA9IGN1ciAmIGNvZGVfbWFzaztcbiAgICBjdXIgPj49IGN1cl9jb2RlX3NpemU7XG4gICAgY3VyX3NoaWZ0IC09IGN1cl9jb2RlX3NpemU7XG5cbiAgICAvLyBUT0RPKGRlYW5tKTogTWF5YmUgc2hvdWxkIGNoZWNrIHRoYXQgdGhlIGZpcnN0IGNvZGUgd2FzIGEgY2xlYXIgY29kZSxcbiAgICAvLyBhdCBsZWFzdCB0aGlzIGlzIHdoYXQgeW91J3JlIHN1cHBvc2VkIHRvIGRvLiAgQnV0IGFjdHVhbGx5IG91ciBlbmNvZGVyXG4gICAgLy8gbm93IGRvZXNuJ3QgZW1pdCBhIGNsZWFyIGNvZGUgZmlyc3QgYW55d2F5LlxuICAgIGlmIChjb2RlID09PSBjbGVhcl9jb2RlKSB7XG4gICAgICAvLyBXZSBkb24ndCBhY3R1YWxseSBoYXZlIHRvIGNsZWFyIHRoZSB0YWJsZS4gIFRoaXMgY291bGQgYmUgYSBnb29kIGlkZWFcbiAgICAgIC8vIGZvciBncmVhdGVyIGVycm9yIGNoZWNraW5nLCBidXQgd2UgZG9uJ3QgcmVhbGx5IGRvIGFueSBhbnl3YXkuICBXZVxuICAgICAgLy8gd2lsbCBqdXN0IHRyYWNrIGl0IHdpdGggbmV4dF9jb2RlIGFuZCBvdmVyd3JpdGUgb2xkIGVudHJpZXMuXG5cbiAgICAgIG5leHRfY29kZSA9IGVvaV9jb2RlICsgMTtcbiAgICAgIGN1cl9jb2RlX3NpemUgPSBtaW5fY29kZV9zaXplICsgMTtcbiAgICAgIGNvZGVfbWFzayA9ICgxIDw8IGN1cl9jb2RlX3NpemUpIC0gMTtcblxuICAgICAgLy8gRG9uJ3QgdXBkYXRlIHByZXZfY29kZSA/XG4gICAgICBwcmV2X2NvZGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfSBlbHNlIGlmIChjb2RlID09PSBlb2lfY29kZSkge1xuICAgICAgYnJlYWs7XG4gICAgfVxuXG4gICAgLy8gV2UgaGF2ZSBhIHNpbWlsYXIgc2l0dWF0aW9uIGFzIHRoZSBkZWNvZGVyLCB3aGVyZSB3ZSB3YW50IHRvIHN0b3JlXG4gICAgLy8gdmFyaWFibGUgbGVuZ3RoIGVudHJpZXMgKGNvZGUgdGFibGUgZW50cmllcyksIGJ1dCB3ZSB3YW50IHRvIGRvIGluIGFcbiAgICAvLyBmYXN0ZXIgbWFubmVyIHRoYW4gYW4gYXJyYXkgb2YgYXJyYXlzLiAgVGhlIGNvZGUgYmVsb3cgc3RvcmVzIHNvcnQgb2YgYVxuICAgIC8vIGxpbmtlZCBsaXN0IHdpdGhpbiB0aGUgY29kZSB0YWJsZSwgYW5kIHRoZW4gXCJjaGFzZXNcIiB0aHJvdWdoIGl0IHRvXG4gICAgLy8gY29uc3RydWN0IHRoZSBkaWN0aW9uYXJ5IGVudHJpZXMuICBXaGVuIGEgbmV3IGVudHJ5IGlzIGNyZWF0ZWQsIGp1c3QgdGhlXG4gICAgLy8gbGFzdCBieXRlIGlzIHN0b3JlZCwgYW5kIHRoZSByZXN0IChwcmVmaXgpIG9mIHRoZSBlbnRyeSBpcyBvbmx5XG4gICAgLy8gcmVmZXJlbmNlZCBieSBpdHMgdGFibGUgZW50cnkuICBUaGVuIHRoZSBjb2RlIGNoYXNlcyB0aHJvdWdoIHRoZVxuICAgIC8vIHByZWZpeGVzIHVudGlsIGl0IHJlYWNoZXMgYSBzaW5nbGUgYnl0ZSBjb2RlLiAgV2UgaGF2ZSB0byBjaGFzZSB0d2ljZSxcbiAgICAvLyBmaXJzdCB0byBjb21wdXRlIHRoZSBsZW5ndGgsIGFuZCB0aGVuIHRvIGFjdHVhbGx5IGNvcHkgdGhlIGRhdGEgdG8gdGhlXG4gICAgLy8gb3V0cHV0IChiYWNrd2FyZHMsIHNpbmNlIHdlIGtub3cgdGhlIGxlbmd0aCkuICBUaGUgYWx0ZXJuYXRpdmUgd291bGQgYmVcbiAgICAvLyBzdG9yaW5nIHNvbWV0aGluZyBpbiBhbiBpbnRlcm1lZGlhdGUgc3RhY2ssIGJ1dCB0aGF0IGRvZXNuJ3QgbWFrZSBhbnlcbiAgICAvLyBtb3JlIHNlbnNlLiAgSSBpbXBsZW1lbnRlZCBhbiBhcHByb2FjaCB3aGVyZSBpdCBhbHNvIHN0b3JlZCB0aGUgbGVuZ3RoXG4gICAgLy8gaW4gdGhlIGNvZGUgdGFibGUsIGFsdGhvdWdoIGl0J3MgYSBiaXQgdHJpY2t5IGJlY2F1c2UgeW91IHJ1biBvdXQgb2ZcbiAgICAvLyBiaXRzICgxMiArIDEyICsgOCksIGJ1dCBJIGRpZG4ndCBtZWFzdXJlIG11Y2ggaW1wcm92ZW1lbnRzICh0aGUgdGFibGVcbiAgICAvLyBlbnRyaWVzIGFyZSBnZW5lcmFsbHkgbm90IHRoZSBsb25nKS4gIEV2ZW4gd2hlbiBJIGNyZWF0ZWQgYmVuY2htYXJrcyBmb3JcbiAgICAvLyB2ZXJ5IGxvbmcgdGFibGUgZW50cmllcyB0aGUgY29tcGxleGl0eSBkaWQgbm90IHNlZW0gd29ydGggaXQuXG4gICAgLy8gVGhlIGNvZGUgdGFibGUgc3RvcmVzIHRoZSBwcmVmaXggZW50cnkgaW4gMTIgYml0cyBhbmQgdGhlbiB0aGUgc3VmZml4XG4gICAgLy8gYnl0ZSBpbiA4IGJpdHMsIHNvIGVhY2ggZW50cnkgaXMgMjAgYml0cy5cblxuICAgIHZhciBjaGFzZV9jb2RlID0gY29kZSA8IG5leHRfY29kZSA/IGNvZGUgOiBwcmV2X2NvZGU7XG5cbiAgICAvLyBDaGFzZSB3aGF0IHdlIHdpbGwgb3V0cHV0LCBlaXRoZXIge0NPREV9IG9yIHtDT0RFLTF9LlxuICAgIHZhciBjaGFzZV9sZW5ndGggPSAwO1xuICAgIHZhciBjaGFzZSA9IGNoYXNlX2NvZGU7XG4gICAgd2hpbGUgKGNoYXNlID4gY2xlYXJfY29kZSkge1xuICAgICAgY2hhc2UgPSBjb2RlX3RhYmxlW2NoYXNlXSA+PiA4O1xuICAgICAgKytjaGFzZV9sZW5ndGg7XG4gICAgfVxuXG4gICAgdmFyIGsgPSBjaGFzZTtcblxuICAgIHZhciBvcF9lbmQgPSBvcCArIGNoYXNlX2xlbmd0aCArIChjaGFzZV9jb2RlICE9PSBjb2RlID8gMSA6IDApO1xuICAgIGlmIChvcF9lbmQgPiBvdXRwdXRfbGVuZ3RoKSB7XG4gICAgICBjb25zb2xlLmxvZyhcIldhcm5pbmcsIGdpZiBzdHJlYW0gbG9uZ2VyIHRoYW4gZXhwZWN0ZWQuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEFscmVhZHkgaGF2ZSB0aGUgZmlyc3QgYnl0ZSBmcm9tIHRoZSBjaGFzZSwgbWlnaHQgYXMgd2VsbCB3cml0ZSBpdCBmYXN0LlxuICAgIG91dHB1dFtvcCsrXSA9IGs7XG5cbiAgICBvcCArPSBjaGFzZV9sZW5ndGg7XG4gICAgdmFyIGIgPSBvcDsgLy8gVHJhY2sgcG9pbnRlciwgd3JpdGluZyBiYWNrd2FyZHMuXG5cbiAgICBpZiAoY2hhc2VfY29kZSAhPT0gY29kZSkgLy8gVGhlIGNhc2Ugb2YgZW1pdHRpbmcge0NPREUtMX0gKyBrLlxuICAgICAgb3V0cHV0W29wKytdID0gaztcblxuICAgIGNoYXNlID0gY2hhc2VfY29kZTtcbiAgICB3aGlsZSAoY2hhc2VfbGVuZ3RoLS0pIHtcbiAgICAgIGNoYXNlID0gY29kZV90YWJsZVtjaGFzZV07XG4gICAgICBvdXRwdXRbLS1iXSA9IGNoYXNlICYgMHhmZjsgLy8gV3JpdGUgYmFja3dhcmRzLlxuICAgICAgY2hhc2UgPj49IDg7IC8vIFB1bGwgZG93biB0byB0aGUgcHJlZml4IGNvZGUuXG4gICAgfVxuXG4gICAgaWYgKHByZXZfY29kZSAhPT0gbnVsbCAmJiBuZXh0X2NvZGUgPCA0MDk2KSB7XG4gICAgICBjb2RlX3RhYmxlW25leHRfY29kZSsrXSA9IHByZXZfY29kZSA8PCA4IHwgaztcbiAgICAgIC8vIFRPRE8oZGVhbm0pOiBGaWd1cmUgb3V0IHRoaXMgY2xlYXJpbmcgdnMgY29kZSBncm93dGggbG9naWMgYmV0dGVyLiAgSVxuICAgICAgLy8gaGF2ZSBhbiBmZWVsaW5nIHRoYXQgaXQgc2hvdWxkIGp1c3QgaGFwcGVuIHNvbWV3aGVyZSBlbHNlLCBmb3Igbm93IGl0XG4gICAgICAvLyBpcyBhd2t3YXJkIGJldHdlZW4gd2hlbiB3ZSBncm93IHBhc3QgdGhlIG1heCBhbmQgdGhlbiBoaXQgYSBjbGVhciBjb2RlLlxuICAgICAgLy8gRm9yIG5vdyBqdXN0IGNoZWNrIGlmIHdlIGhpdCB0aGUgbWF4IDEyLWJpdHMgKHRoZW4gYSBjbGVhciBjb2RlIHNob3VsZFxuICAgICAgLy8gZm9sbG93LCBhbHNvIG9mIGNvdXJzZSBlbmNvZGVkIGluIDEyLWJpdHMpLlxuICAgICAgaWYgKG5leHRfY29kZSA+PSBjb2RlX21hc2sgKyAxICYmIGN1cl9jb2RlX3NpemUgPCAxMikge1xuICAgICAgICArK2N1cl9jb2RlX3NpemU7XG4gICAgICAgIGNvZGVfbWFzayA9IGNvZGVfbWFzayA8PCAxIHwgMTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBwcmV2X2NvZGUgPSBjb2RlO1xuICB9XG5cbiAgaWYgKG9wICE9PSBvdXRwdXRfbGVuZ3RoKSB7XG4gICAgY29uc29sZS5sb2coXCJXYXJuaW5nLCBnaWYgc3RyZWFtIHNob3J0ZXIgdGhhbiBleHBlY3RlZC5cIik7XG4gIH1cblxuICByZXR1cm4gb3V0cHV0O1xufVxuXG5leHBvcnQgZGVmYXVsdCBHaWZSZWFkZXI7IiwiaW1wb3J0IHBha28gZnJvbSAncGFrbydcblxudmFyIFVQTkcgPSB7fTtcblxuaWYgKFVpbnQ4QXJyYXkgJiYgIVVpbnQ4QXJyYXkucHJvdG90eXBlLnNsaWNlKSB7XG4gICAgVWludDhBcnJheS5wcm90b3R5cGUuc2xpY2UgPSBmdW5jdGlvbiAoLi4uYXJnKSB7XG4gICAgICAgIHJldHVybiBuZXcgVWludDhBcnJheSh0aGlzKS5zdWJhcnJheSguLi5hcmcpO1xuICAgIH07XG59O1xuKGZ1bmN0aW9uIChVUE5HLCBwYWtvKSB7XG4gICAgVVBORy50b1JHQkE4ID0gZnVuY3Rpb24gKG91dCkge1xuICAgICAgICB2YXIgdyA9IG91dC53aWR0aCxcbiAgICAgICAgICAgIGggPSBvdXQuaGVpZ2h0O1xuICAgICAgICBpZiAob3V0LnRhYnMuYWNUTCA9PSBudWxsKSByZXR1cm4gW1VQTkcudG9SR0JBOC5kZWNvZGVJbWFnZShvdXQuZGF0YSwgdywgaCwgb3V0KS5idWZmZXJdO1xuXG4gICAgICAgIHZhciBmcm1zID0gW107XG4gICAgICAgIGlmIChvdXQuZnJhbWVzWzBdLmRhdGEgPT0gbnVsbCkgb3V0LmZyYW1lc1swXS5kYXRhID0gb3V0LmRhdGE7XG5cbiAgICAgICAgdmFyIGltZywgZW1wdHkgPSBuZXcgVWludDhBcnJheSh3ICogaCAqIDQpO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IG91dC5mcmFtZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBmcm0gPSBvdXQuZnJhbWVzW2ldO1xuICAgICAgICAgICAgdmFyIGZ4ID0gZnJtLnJlY3QueCxcbiAgICAgICAgICAgICAgICBmeSA9IGZybS5yZWN0LnksXG4gICAgICAgICAgICAgICAgZncgPSBmcm0ucmVjdC53aWR0aCxcbiAgICAgICAgICAgICAgICBmaCA9IGZybS5yZWN0LmhlaWdodDtcbiAgICAgICAgICAgIHZhciBmZGF0YSA9IFVQTkcudG9SR0JBOC5kZWNvZGVJbWFnZShmcm0uZGF0YSwgZncsIGZoLCBvdXQpO1xuXG4gICAgICAgICAgICBpZiAoaSA9PSAwKSBpbWcgPSBmZGF0YTtcbiAgICAgICAgICAgIGVsc2UgaWYgKGZybS5ibGVuZCA9PSAwKSBVUE5HLl9jb3B5VGlsZShmZGF0YSwgZncsIGZoLCBpbWcsIHcsIGgsIGZ4LCBmeSwgMCk7XG4gICAgICAgICAgICBlbHNlIGlmIChmcm0uYmxlbmQgPT0gMSkgVVBORy5fY29weVRpbGUoZmRhdGEsIGZ3LCBmaCwgaW1nLCB3LCBoLCBmeCwgZnksIDEpO1xuXG4gICAgICAgICAgICBmcm1zLnB1c2goaW1nLmJ1ZmZlcik7XG4gICAgICAgICAgICBpbWcgPSBpbWcuc2xpY2UoMCk7XG5cbiAgICAgICAgICAgIGlmIChmcm0uZGlzcG9zZSA9PSAwKSB7fSBlbHNlIGlmIChmcm0uZGlzcG9zZSA9PSAxKSBVUE5HLl9jb3B5VGlsZShlbXB0eSwgZncsIGZoLCBpbWcsIHcsIGgsIGZ4LCBmeSwgMCk7XG4gICAgICAgICAgICBlbHNlIGlmIChmcm0uZGlzcG9zZSA9PSAyKSB7XG4gICAgICAgICAgICAgICAgdmFyIHBpID0gaSAtIDE7XG4gICAgICAgICAgICAgICAgd2hpbGUgKG91dC5mcmFtZXNbcGldLmRpc3Bvc2UgPT0gMikgcGktLTtcbiAgICAgICAgICAgICAgICBpbWcgPSBuZXcgVWludDhBcnJheShmcm1zW3BpXSkuc2xpY2UoMCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZybXM7XG4gICAgfVxuICAgIFVQTkcudG9SR0JBOC5kZWNvZGVJbWFnZSA9IGZ1bmN0aW9uIChkYXRhLCB3LCBoLCBvdXQpIHtcbiAgICAgICAgdmFyIGFyZWEgPSB3ICogaCxcbiAgICAgICAgICAgIGJwcCA9IFVQTkcuZGVjb2RlLl9nZXRCUFAob3V0KTtcbiAgICAgICAgdmFyIGJwbCA9IE1hdGguY2VpbCh3ICogYnBwIC8gOCk7IC8vIGJ5dGVzIHBlciBsaW5lXG4gICAgICAgIHZhciBiZiA9IG5ldyBVaW50OEFycmF5KGFyZWEgKiA0KSxcbiAgICAgICAgICAgIGJmMzIgPSBuZXcgVWludDMyQXJyYXkoYmYuYnVmZmVyKTtcbiAgICAgICAgdmFyIGN0eXBlID0gb3V0LmN0eXBlLFxuICAgICAgICAgICAgZGVwdGggPSBvdXQuZGVwdGg7XG4gICAgICAgIHZhciBycyA9IFVQTkcuX2Jpbi5yZWFkVXNob3J0O1xuXG4gICAgICAgIC8vY29uc29sZS5sb2coY3R5cGUsIGRlcHRoKTtcbiAgICAgICAgaWYgKGN0eXBlID09IDYpIHsgLy8gUkdCICsgYWxwaGFcbiAgICAgICAgICAgIHZhciBxYXJlYSA9IGFyZWEgPDwgMjtcbiAgICAgICAgICAgIGlmIChkZXB0aCA9PSA4KVxuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcWFyZWE7IGkrKykge1xuICAgICAgICAgICAgICAgICAgICBiZltpXSA9IGRhdGFbaV07XG4gICAgICAgICAgICAgICAgICAgIC8qaWYoKGkmMyk9PTMgJiYgZGF0YVtpXSE9MCkgYmZbaV09MjU1OyovXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGRlcHRoID09IDE2KVxuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcWFyZWE7IGkrKykge1xuICAgICAgICAgICAgICAgICAgICBiZltpXSA9IGRhdGFbaSA8PCAxXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoY3R5cGUgPT0gMikgeyAvLyBSR0JcbiAgICAgICAgICAgIHZhciB0cyA9IG91dC50YWJzW1widFJOU1wiXSxcbiAgICAgICAgICAgICAgICB0ciA9IC0xLFxuICAgICAgICAgICAgICAgIHRnID0gLTEsXG4gICAgICAgICAgICAgICAgdGIgPSAtMTtcbiAgICAgICAgICAgIGlmICh0cykge1xuICAgICAgICAgICAgICAgIHRyID0gdHNbMF07XG4gICAgICAgICAgICAgICAgdGcgPSB0c1sxXTtcbiAgICAgICAgICAgICAgICB0YiA9IHRzWzJdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGRlcHRoID09IDgpXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcmVhOyBpKyspIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHFpID0gaSA8PCAyLFxuICAgICAgICAgICAgICAgICAgICAgICAgdGkgPSBpICogMztcbiAgICAgICAgICAgICAgICAgICAgYmZbcWldID0gZGF0YVt0aV07XG4gICAgICAgICAgICAgICAgICAgIGJmW3FpICsgMV0gPSBkYXRhW3RpICsgMV07XG4gICAgICAgICAgICAgICAgICAgIGJmW3FpICsgMl0gPSBkYXRhW3RpICsgMl07XG4gICAgICAgICAgICAgICAgICAgIGJmW3FpICsgM10gPSAyNTU7XG4gICAgICAgICAgICAgICAgICAgIGlmICh0ciAhPSAtMSAmJiBkYXRhW3RpXSA9PSB0ciAmJiBkYXRhW3RpICsgMV0gPT0gdGcgJiYgZGF0YVt0aSArIDJdID09IHRiKSBiZltxaSArIDNdID0gMDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoZGVwdGggPT0gMTYpXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcmVhOyBpKyspIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHFpID0gaSA8PCAyLFxuICAgICAgICAgICAgICAgICAgICAgICAgdGkgPSBpICogNjtcbiAgICAgICAgICAgICAgICAgICAgYmZbcWldID0gZGF0YVt0aV07XG4gICAgICAgICAgICAgICAgICAgIGJmW3FpICsgMV0gPSBkYXRhW3RpICsgMl07XG4gICAgICAgICAgICAgICAgICAgIGJmW3FpICsgMl0gPSBkYXRhW3RpICsgNF07XG4gICAgICAgICAgICAgICAgICAgIGJmW3FpICsgM10gPSAyNTU7XG4gICAgICAgICAgICAgICAgICAgIGlmICh0ciAhPSAtMSAmJiBycyhkYXRhLCB0aSkgPT0gdHIgJiYgcnMoZGF0YSwgdGkgKyAyKSA9PSB0ZyAmJiBycyhkYXRhLCB0aSArIDQpID09IHRiKSBiZltxaSArIDNdID0gMDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoY3R5cGUgPT0gMykgeyAvLyBwYWxldHRlXG4gICAgICAgICAgICB2YXIgcCA9IG91dC50YWJzW1wiUExURVwiXSxcbiAgICAgICAgICAgICAgICBhcCA9IG91dC50YWJzW1widFJOU1wiXSxcbiAgICAgICAgICAgICAgICB0bCA9IGFwID8gYXAubGVuZ3RoIDogMDtcbiAgICAgICAgICAgIC8vY29uc29sZS5sb2cocCwgYXApO1xuICAgICAgICAgICAgaWYgKGRlcHRoID09IDEpXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgeSA9IDA7IHkgPCBoOyB5KyspIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHMwID0geSAqIGJwbCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHQwID0geSAqIHc7XG4gICAgICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdzsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgcWkgPSAodDAgKyBpKSA8PCAyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGogPSAoKGRhdGFbczAgKyAoaSA+PiAzKV0gPj4gKDcgLSAoKGkgJiA3KSA8PCAwKSkpICYgMSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2ogPSAzICogajtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJmW3FpXSA9IHBbY2pdO1xuICAgICAgICAgICAgICAgICAgICAgICAgYmZbcWkgKyAxXSA9IHBbY2ogKyAxXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJmW3FpICsgMl0gPSBwW2NqICsgMl07XG4gICAgICAgICAgICAgICAgICAgICAgICBiZltxaSArIDNdID0gKGogPCB0bCkgPyBhcFtqXSA6IDI1NTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChkZXB0aCA9PSAyKVxuICAgICAgICAgICAgICAgIGZvciAodmFyIHkgPSAwOyB5IDwgaDsgeSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBzMCA9IHkgKiBicGwsXG4gICAgICAgICAgICAgICAgICAgICAgICB0MCA9IHkgKiB3O1xuICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHc7IGkrKykge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHFpID0gKHQwICsgaSkgPDwgMixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBqID0gKChkYXRhW3MwICsgKGkgPj4gMildID4+ICg2IC0gKChpICYgMykgPDwgMSkpKSAmIDMpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNqID0gMyAqIGo7XG4gICAgICAgICAgICAgICAgICAgICAgICBiZltxaV0gPSBwW2NqXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJmW3FpICsgMV0gPSBwW2NqICsgMV07XG4gICAgICAgICAgICAgICAgICAgICAgICBiZltxaSArIDJdID0gcFtjaiArIDJdO1xuICAgICAgICAgICAgICAgICAgICAgICAgYmZbcWkgKyAzXSA9IChqIDwgdGwpID8gYXBbal0gOiAyNTU7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoZGVwdGggPT0gNClcbiAgICAgICAgICAgICAgICBmb3IgKHZhciB5ID0gMDsgeSA8IGg7IHkrKykge1xuICAgICAgICAgICAgICAgICAgICB2YXIgczAgPSB5ICogYnBsLFxuICAgICAgICAgICAgICAgICAgICAgICAgdDAgPSB5ICogdztcbiAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB3OyBpKyspIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBxaSA9ICh0MCArIGkpIDw8IDIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaiA9ICgoZGF0YVtzMCArIChpID4+IDEpXSA+PiAoNCAtICgoaSAmIDEpIDw8IDIpKSkgJiAxNSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2ogPSAzICogajtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJmW3FpXSA9IHBbY2pdO1xuICAgICAgICAgICAgICAgICAgICAgICAgYmZbcWkgKyAxXSA9IHBbY2ogKyAxXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJmW3FpICsgMl0gPSBwW2NqICsgMl07XG4gICAgICAgICAgICAgICAgICAgICAgICBiZltxaSArIDNdID0gKGogPCB0bCkgPyBhcFtqXSA6IDI1NTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChkZXB0aCA9PSA4KVxuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJlYTsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBxaSA9IGkgPDwgMixcbiAgICAgICAgICAgICAgICAgICAgICAgIGogPSBkYXRhW2ldLFxuICAgICAgICAgICAgICAgICAgICAgICAgY2ogPSAzICogajtcbiAgICAgICAgICAgICAgICAgICAgYmZbcWldID0gcFtjal07XG4gICAgICAgICAgICAgICAgICAgIGJmW3FpICsgMV0gPSBwW2NqICsgMV07XG4gICAgICAgICAgICAgICAgICAgIGJmW3FpICsgMl0gPSBwW2NqICsgMl07XG4gICAgICAgICAgICAgICAgICAgIGJmW3FpICsgM10gPSAoaiA8IHRsKSA/IGFwW2pdIDogMjU1O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChjdHlwZSA9PSA0KSB7IC8vIGdyYXkgKyBhbHBoYVxuICAgICAgICAgICAgaWYgKGRlcHRoID09IDgpXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcmVhOyBpKyspIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHFpID0gaSA8PCAyLFxuICAgICAgICAgICAgICAgICAgICAgICAgZGkgPSBpIDw8IDEsXG4gICAgICAgICAgICAgICAgICAgICAgICBnciA9IGRhdGFbZGldO1xuICAgICAgICAgICAgICAgICAgICBiZltxaV0gPSBncjtcbiAgICAgICAgICAgICAgICAgICAgYmZbcWkgKyAxXSA9IGdyO1xuICAgICAgICAgICAgICAgICAgICBiZltxaSArIDJdID0gZ3I7XG4gICAgICAgICAgICAgICAgICAgIGJmW3FpICsgM10gPSBkYXRhW2RpICsgMV07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGRlcHRoID09IDE2KVxuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJlYTsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBxaSA9IGkgPDwgMixcbiAgICAgICAgICAgICAgICAgICAgICAgIGRpID0gaSA8PCAyLFxuICAgICAgICAgICAgICAgICAgICAgICAgZ3IgPSBkYXRhW2RpXTtcbiAgICAgICAgICAgICAgICAgICAgYmZbcWldID0gZ3I7XG4gICAgICAgICAgICAgICAgICAgIGJmW3FpICsgMV0gPSBncjtcbiAgICAgICAgICAgICAgICAgICAgYmZbcWkgKyAyXSA9IGdyO1xuICAgICAgICAgICAgICAgICAgICBiZltxaSArIDNdID0gZGF0YVtkaSArIDJdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChjdHlwZSA9PSAwKSB7IC8vIGdyYXlcbiAgICAgICAgICAgIHZhciB0ciA9IG91dC50YWJzW1widFJOU1wiXSA/IG91dC50YWJzW1widFJOU1wiXSA6IC0xO1xuICAgICAgICAgICAgaWYgKGRlcHRoID09IDEpXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcmVhOyBpKyspIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGdyID0gMjU1ICogKChkYXRhW2kgPj4gM10gPj4gKDcgLSAoKGkgJiA3KSkpKSAmIDEpLFxuICAgICAgICAgICAgICAgICAgICAgICAgYWwgPSAoZ3IgPT0gdHIgKiAyNTUpID8gMCA6IDI1NTtcbiAgICAgICAgICAgICAgICAgICAgYmYzMltpXSA9IChhbCA8PCAyNCkgfCAoZ3IgPDwgMTYpIHwgKGdyIDw8IDgpIHwgZ3I7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGRlcHRoID09IDIpXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcmVhOyBpKyspIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGdyID0gODUgKiAoKGRhdGFbaSA+PiAyXSA+PiAoNiAtICgoaSAmIDMpIDw8IDEpKSkgJiAzKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGFsID0gKGdyID09IHRyICogODUpID8gMCA6IDI1NTtcbiAgICAgICAgICAgICAgICAgICAgYmYzMltpXSA9IChhbCA8PCAyNCkgfCAoZ3IgPDwgMTYpIHwgKGdyIDw8IDgpIHwgZ3I7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGRlcHRoID09IDQpXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcmVhOyBpKyspIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGdyID0gMTcgKiAoKGRhdGFbaSA+PiAxXSA+PiAoNCAtICgoaSAmIDEpIDw8IDIpKSkgJiAxNSksXG4gICAgICAgICAgICAgICAgICAgICAgICBhbCA9IChnciA9PSB0ciAqIDE3KSA/IDAgOiAyNTU7XG4gICAgICAgICAgICAgICAgICAgIGJmMzJbaV0gPSAoYWwgPDwgMjQpIHwgKGdyIDw8IDE2KSB8IChnciA8PCA4KSB8IGdyO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChkZXB0aCA9PSA4KVxuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJlYTsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBnciA9IGRhdGFbaV0sXG4gICAgICAgICAgICAgICAgICAgICAgICBhbCA9IChnciA9PSB0cikgPyAwIDogMjU1O1xuICAgICAgICAgICAgICAgICAgICBiZjMyW2ldID0gKGFsIDw8IDI0KSB8IChnciA8PCAxNikgfCAoZ3IgPDwgOCkgfCBncjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoZGVwdGggPT0gMTYpXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcmVhOyBpKyspIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGdyID0gZGF0YVtpIDw8IDFdLFxuICAgICAgICAgICAgICAgICAgICAgICAgYWwgPSAocnMoZGF0YSwgaSA8PCAxKSA9PSB0cikgPyAwIDogMjU1O1xuICAgICAgICAgICAgICAgICAgICBiZjMyW2ldID0gKGFsIDw8IDI0KSB8IChnciA8PCAxNikgfCAoZ3IgPDwgOCkgfCBncjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGJmO1xuICAgIH1cblxuICAgIFVQTkcuZGVjb2RlID0gZnVuY3Rpb24gKGJ1ZmYpIHtcbiAgICAgICAgdmFyIGRhdGEgPSBuZXcgVWludDhBcnJheShidWZmKSxcbiAgICAgICAgICAgIG9mZnNldCA9IDgsXG4gICAgICAgICAgICBiaW4gPSBVUE5HLl9iaW4sXG4gICAgICAgICAgICByVXMgPSBiaW4ucmVhZFVzaG9ydCxcbiAgICAgICAgICAgIHJVaSA9IGJpbi5yZWFkVWludDtcbiAgICAgICAgdmFyIG91dCA9IHtcbiAgICAgICAgICAgIHRhYnM6IHt9LFxuICAgICAgICAgICAgZnJhbWVzOiBbXVxuICAgICAgICB9O1xuICAgICAgICB2YXIgZGQgPSBuZXcgVWludDhBcnJheShkYXRhLmxlbmd0aCksXG4gICAgICAgICAgICBkb2ZmID0gMDsgLy8gcHV0IGFsbCBJREFUIGRhdGEgaW50byBpdFxuICAgICAgICB2YXIgZmQsIGZvZmYgPSAwOyAvLyBmcmFtZXNcbiAgICAgICAgdmFyIG1nY2sgPSBbMHg4OSwgMHg1MCwgMHg0ZSwgMHg0NywgMHgwZCwgMHgwYSwgMHgxYSwgMHgwYV07XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgODsgaSsrKVxuICAgICAgICAgICAgaWYgKGRhdGFbaV0gIT0gbWdja1tpXSkgdGhyb3cgXCJUaGUgaW5wdXQgaXMgbm90IGEgUE5HIGZpbGUhXCI7XG5cbiAgICAgICAgd2hpbGUgKG9mZnNldCA8IGRhdGEubGVuZ3RoKSB7XG4gICAgICAgICAgICB2YXIgbGVuID0gYmluLnJlYWRVaW50KGRhdGEsIG9mZnNldCk7XG4gICAgICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgICAgIHZhciB0eXBlID0gYmluLnJlYWRBU0NJSShkYXRhLCBvZmZzZXQsIDQpO1xuICAgICAgICAgICAgb2Zmc2V0ICs9IDQ7XG4gICAgICAgICAgICAvL2NvbnNvbGUubG9nKHR5cGUsbGVuKTtcbiAgICAgICAgICAgIGlmICh0eXBlID09IFwiSUhEUlwiKSB7XG4gICAgICAgICAgICAgICAgVVBORy5kZWNvZGUuX0lIRFIoZGF0YSwgb2Zmc2V0LCBvdXQpO1xuICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlID09IFwiSURBVFwiKSB7XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykgZGRbZG9mZiArIGldID0gZGF0YVtvZmZzZXQgKyBpXTtcbiAgICAgICAgICAgICAgICBkb2ZmICs9IGxlbjtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PSBcImFjVExcIikge1xuICAgICAgICAgICAgICAgIG91dC50YWJzW3R5cGVdID0ge1xuICAgICAgICAgICAgICAgICAgICBudW1fZnJhbWVzOiByVWkoZGF0YSwgb2Zmc2V0KSxcbiAgICAgICAgICAgICAgICAgICAgbnVtX3BsYXlzOiByVWkoZGF0YSwgb2Zmc2V0ICsgNClcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIGZkID0gbmV3IFVpbnQ4QXJyYXkoZGF0YS5sZW5ndGgpO1xuICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlID09IFwiZmNUTFwiKSB7XG4gICAgICAgICAgICAgICAgaWYgKGZvZmYgIT0gMCkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgZnIgPSBvdXQuZnJhbWVzW291dC5mcmFtZXMubGVuZ3RoIC0gMV07XG4gICAgICAgICAgICAgICAgICAgIGZyLmRhdGEgPSBVUE5HLmRlY29kZS5fZGVjb21wcmVzcyhvdXQsIGZkLnNsaWNlKDAsIGZvZmYpLCBmci5yZWN0LndpZHRoLCBmci5yZWN0LmhlaWdodCk7XG4gICAgICAgICAgICAgICAgICAgIGZvZmYgPSAwO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB2YXIgcmN0ID0ge1xuICAgICAgICAgICAgICAgICAgICB4OiByVWkoZGF0YSwgb2Zmc2V0ICsgMTIpLFxuICAgICAgICAgICAgICAgICAgICB5OiByVWkoZGF0YSwgb2Zmc2V0ICsgMTYpLFxuICAgICAgICAgICAgICAgICAgICB3aWR0aDogclVpKGRhdGEsIG9mZnNldCArIDQpLFxuICAgICAgICAgICAgICAgICAgICBoZWlnaHQ6IHJVaShkYXRhLCBvZmZzZXQgKyA4KVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgdmFyIGRlbCA9IHJVcyhkYXRhLCBvZmZzZXQgKyAyMik7XG4gICAgICAgICAgICAgICAgZGVsID0gclVzKGRhdGEsIG9mZnNldCArIDIwKSAvIChkZWwgPT0gMCA/IDEwMCA6IGRlbCk7XG4gICAgICAgICAgICAgICAgdmFyIGZybSA9IHtcbiAgICAgICAgICAgICAgICAgICAgcmVjdDogcmN0LFxuICAgICAgICAgICAgICAgICAgICBkZWxheTogTWF0aC5yb3VuZChkZWwgKiAxMDAwKSxcbiAgICAgICAgICAgICAgICAgICAgZGlzcG9zZTogZGF0YVtvZmZzZXQgKyAyNF0sXG4gICAgICAgICAgICAgICAgICAgIGJsZW5kOiBkYXRhW29mZnNldCArIDI1XVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgLy9jb25zb2xlLmxvZyhmcm0pO1xuICAgICAgICAgICAgICAgIG91dC5mcmFtZXMucHVzaChmcm0pO1xuICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlID09IFwiZmRBVFwiKSB7XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW4gLSA0OyBpKyspIGZkW2ZvZmYgKyBpXSA9IGRhdGFbb2Zmc2V0ICsgaSArIDRdO1xuICAgICAgICAgICAgICAgIGZvZmYgKz0gbGVuIC0gNDtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PSBcInBIWXNcIikge1xuICAgICAgICAgICAgICAgIG91dC50YWJzW3R5cGVdID0gW2Jpbi5yZWFkVWludChkYXRhLCBvZmZzZXQpLCBiaW4ucmVhZFVpbnQoZGF0YSwgb2Zmc2V0ICsgNCksIGRhdGFbb2Zmc2V0ICsgOF1dO1xuICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlID09IFwiY0hSTVwiKSB7XG4gICAgICAgICAgICAgICAgb3V0LnRhYnNbdHlwZV0gPSBbXTtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IDg7IGkrKykgb3V0LnRhYnNbdHlwZV0ucHVzaChiaW4ucmVhZFVpbnQoZGF0YSwgb2Zmc2V0ICsgaSAqIDQpKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PSBcInRFWHRcIikge1xuICAgICAgICAgICAgICAgIGlmIChvdXQudGFic1t0eXBlXSA9PSBudWxsKSBvdXQudGFic1t0eXBlXSA9IHt9O1xuICAgICAgICAgICAgICAgIHZhciBueiA9IGJpbi5uZXh0WmVybyhkYXRhLCBvZmZzZXQpO1xuICAgICAgICAgICAgICAgIHZhciBrZXl3ID0gYmluLnJlYWRBU0NJSShkYXRhLCBvZmZzZXQsIG56IC0gb2Zmc2V0KTtcbiAgICAgICAgICAgICAgICB2YXIgdGV4dCA9IGJpbi5yZWFkQVNDSUkoZGF0YSwgbnogKyAxLCBvZmZzZXQgKyBsZW4gLSBueiAtIDEpO1xuICAgICAgICAgICAgICAgIG91dC50YWJzW3R5cGVdW2tleXddID0gdGV4dDtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PSBcImlUWHRcIikge1xuICAgICAgICAgICAgICAgIGlmIChvdXQudGFic1t0eXBlXSA9PSBudWxsKSBvdXQudGFic1t0eXBlXSA9IHt9O1xuICAgICAgICAgICAgICAgIHZhciBueiA9IDAsXG4gICAgICAgICAgICAgICAgICAgIG9mZiA9IG9mZnNldDtcbiAgICAgICAgICAgICAgICBueiA9IGJpbi5uZXh0WmVybyhkYXRhLCBvZmYpO1xuICAgICAgICAgICAgICAgIHZhciBrZXl3ID0gYmluLnJlYWRBU0NJSShkYXRhLCBvZmYsIG56IC0gb2ZmKTtcbiAgICAgICAgICAgICAgICBvZmYgPSBueiArIDE7XG4gICAgICAgICAgICAgICAgdmFyIGNmbGFnID0gZGF0YVtvZmZdLFxuICAgICAgICAgICAgICAgICAgICBjbWV0aCA9IGRhdGFbb2ZmICsgMV07XG4gICAgICAgICAgICAgICAgb2ZmICs9IDI7XG4gICAgICAgICAgICAgICAgbnogPSBiaW4ubmV4dFplcm8oZGF0YSwgb2ZmKTtcbiAgICAgICAgICAgICAgICB2YXIgbHRhZyA9IGJpbi5yZWFkQVNDSUkoZGF0YSwgb2ZmLCBueiAtIG9mZik7XG4gICAgICAgICAgICAgICAgb2ZmID0gbnogKyAxO1xuICAgICAgICAgICAgICAgIG56ID0gYmluLm5leHRaZXJvKGRhdGEsIG9mZik7XG4gICAgICAgICAgICAgICAgdmFyIHRrZXl3ID0gYmluLnJlYWRVVEY4KGRhdGEsIG9mZiwgbnogLSBvZmYpO1xuICAgICAgICAgICAgICAgIG9mZiA9IG56ICsgMTtcbiAgICAgICAgICAgICAgICB2YXIgdGV4dCA9IGJpbi5yZWFkVVRGOChkYXRhLCBvZmYsIGxlbiAtIChvZmYgLSBvZmZzZXQpKTtcbiAgICAgICAgICAgICAgICBvdXQudGFic1t0eXBlXVtrZXl3XSA9IHRleHQ7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHR5cGUgPT0gXCJQTFRFXCIpIHtcbiAgICAgICAgICAgICAgICBvdXQudGFic1t0eXBlXSA9IGJpbi5yZWFkQnl0ZXMoZGF0YSwgb2Zmc2V0LCBsZW4pO1xuICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlID09IFwiaElTVFwiKSB7XG4gICAgICAgICAgICAgICAgdmFyIHBsID0gb3V0LnRhYnNbXCJQTFRFXCJdLmxlbmd0aCAvIDM7XG4gICAgICAgICAgICAgICAgb3V0LnRhYnNbdHlwZV0gPSBbXTtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBsOyBpKyspIG91dC50YWJzW3R5cGVdLnB1c2goclVzKGRhdGEsIG9mZnNldCArIGkgKiAyKSk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHR5cGUgPT0gXCJ0Uk5TXCIpIHtcbiAgICAgICAgICAgICAgICBpZiAob3V0LmN0eXBlID09IDMpIG91dC50YWJzW3R5cGVdID0gYmluLnJlYWRCeXRlcyhkYXRhLCBvZmZzZXQsIGxlbik7XG4gICAgICAgICAgICAgICAgZWxzZSBpZiAob3V0LmN0eXBlID09IDApIG91dC50YWJzW3R5cGVdID0gclVzKGRhdGEsIG9mZnNldCk7XG4gICAgICAgICAgICAgICAgZWxzZSBpZiAob3V0LmN0eXBlID09IDIpIG91dC50YWJzW3R5cGVdID0gW3JVcyhkYXRhLCBvZmZzZXQpLCByVXMoZGF0YSwgb2Zmc2V0ICsgMiksIHJVcyhkYXRhLCBvZmZzZXQgKyA0KV07XG4gICAgICAgICAgICAgICAgLy9lbHNlIGNvbnNvbGUubG9nKFwidFJOUyBmb3IgdW5zdXBwb3J0ZWQgY29sb3IgdHlwZVwiLG91dC5jdHlwZSwgbGVuKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PSBcImdBTUFcIikgb3V0LnRhYnNbdHlwZV0gPSBiaW4ucmVhZFVpbnQoZGF0YSwgb2Zmc2V0KSAvIDEwMDAwMDtcbiAgICAgICAgICAgIGVsc2UgaWYgKHR5cGUgPT0gXCJzUkdCXCIpIG91dC50YWJzW3R5cGVdID0gZGF0YVtvZmZzZXRdO1xuICAgICAgICAgICAgZWxzZSBpZiAodHlwZSA9PSBcImJLR0RcIikge1xuICAgICAgICAgICAgICAgIGlmIChvdXQuY3R5cGUgPT0gMCB8fCBvdXQuY3R5cGUgPT0gNCkgb3V0LnRhYnNbdHlwZV0gPSBbclVzKGRhdGEsIG9mZnNldCldO1xuICAgICAgICAgICAgICAgIGVsc2UgaWYgKG91dC5jdHlwZSA9PSAyIHx8IG91dC5jdHlwZSA9PSA2KSBvdXQudGFic1t0eXBlXSA9IFtyVXMoZGF0YSwgb2Zmc2V0KSwgclVzKGRhdGEsIG9mZnNldCArIDIpLCByVXMoZGF0YSwgb2Zmc2V0ICsgNCldO1xuICAgICAgICAgICAgICAgIGVsc2UgaWYgKG91dC5jdHlwZSA9PSAzKSBvdXQudGFic1t0eXBlXSA9IGRhdGFbb2Zmc2V0XTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PSBcIklFTkRcIikge1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgb2Zmc2V0ICs9IGxlbjtcbiAgICAgICAgICAgIHZhciBjcmMgPSBiaW4ucmVhZFVpbnQoZGF0YSwgb2Zmc2V0KTtcbiAgICAgICAgICAgIG9mZnNldCArPSA0O1xuICAgICAgICB9XG4gICAgICAgIGlmIChmb2ZmICE9IDApIHtcbiAgICAgICAgICAgIHZhciBmciA9IG91dC5mcmFtZXNbb3V0LmZyYW1lcy5sZW5ndGggLSAxXTtcbiAgICAgICAgICAgIGZyLmRhdGEgPSBVUE5HLmRlY29kZS5fZGVjb21wcmVzcyhvdXQsIGZkLnNsaWNlKDAsIGZvZmYpLCBmci5yZWN0LndpZHRoLCBmci5yZWN0LmhlaWdodCk7XG4gICAgICAgICAgICBmb2ZmID0gMDtcbiAgICAgICAgfVxuICAgICAgICBvdXQuZGF0YSA9IFVQTkcuZGVjb2RlLl9kZWNvbXByZXNzKG91dCwgZGQsIG91dC53aWR0aCwgb3V0LmhlaWdodCk7XG5cbiAgICAgICAgZGVsZXRlIG91dC5jb21wcmVzcztcbiAgICAgICAgZGVsZXRlIG91dC5pbnRlcmxhY2U7XG4gICAgICAgIGRlbGV0ZSBvdXQuZmlsdGVyO1xuICAgICAgICByZXR1cm4gb3V0O1xuICAgIH1cblxuICAgIFVQTkcuZGVjb2RlLl9kZWNvbXByZXNzID0gZnVuY3Rpb24gKG91dCwgZGQsIHcsIGgpIHtcbiAgICAgICAgaWYgKG91dC5jb21wcmVzcyA9PSAwKSBkZCA9IFVQTkcuZGVjb2RlLl9pbmZsYXRlKGRkKTtcblxuICAgICAgICBpZiAob3V0LmludGVybGFjZSA9PSAwKSBkZCA9IFVQTkcuZGVjb2RlLl9maWx0ZXJaZXJvKGRkLCBvdXQsIDAsIHcsIGgpO1xuICAgICAgICBlbHNlIGlmIChvdXQuaW50ZXJsYWNlID09IDEpIGRkID0gVVBORy5kZWNvZGUuX3JlYWRJbnRlcmxhY2UoZGQsIG91dCk7XG4gICAgICAgIHJldHVybiBkZDtcbiAgICB9XG5cbiAgICBVUE5HLmRlY29kZS5faW5mbGF0ZSA9IGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgIHJldHVybiBwYWtvW1wiaW5mbGF0ZVwiXShkYXRhKTtcbiAgICB9XG5cbiAgICBVUE5HLmRlY29kZS5fcmVhZEludGVybGFjZSA9IGZ1bmN0aW9uIChkYXRhLCBvdXQpIHtcbiAgICAgICAgdmFyIHcgPSBvdXQud2lkdGgsXG4gICAgICAgICAgICBoID0gb3V0LmhlaWdodDtcbiAgICAgICAgdmFyIGJwcCA9IFVQTkcuZGVjb2RlLl9nZXRCUFAob3V0KSxcbiAgICAgICAgICAgIGNicHAgPSBicHAgPj4gMyxcbiAgICAgICAgICAgIGJwbCA9IE1hdGguY2VpbCh3ICogYnBwIC8gOCk7XG4gICAgICAgIHZhciBpbWcgPSBuZXcgVWludDhBcnJheShoICogYnBsKTtcbiAgICAgICAgdmFyIGRpID0gMDtcblxuICAgICAgICB2YXIgc3RhcnRpbmdfcm93ID0gWzAsIDAsIDQsIDAsIDIsIDAsIDFdO1xuICAgICAgICB2YXIgc3RhcnRpbmdfY29sID0gWzAsIDQsIDAsIDIsIDAsIDEsIDBdO1xuICAgICAgICB2YXIgcm93X2luY3JlbWVudCA9IFs4LCA4LCA4LCA0LCA0LCAyLCAyXTtcbiAgICAgICAgdmFyIGNvbF9pbmNyZW1lbnQgPSBbOCwgOCwgNCwgNCwgMiwgMiwgMV07XG5cbiAgICAgICAgdmFyIHBhc3MgPSAwO1xuICAgICAgICB3aGlsZSAocGFzcyA8IDcpIHtcbiAgICAgICAgICAgIHZhciByaSA9IHJvd19pbmNyZW1lbnRbcGFzc10sXG4gICAgICAgICAgICAgICAgY2kgPSBjb2xfaW5jcmVtZW50W3Bhc3NdO1xuICAgICAgICAgICAgdmFyIHN3ID0gMCxcbiAgICAgICAgICAgICAgICBzaCA9IDA7XG4gICAgICAgICAgICB2YXIgY3IgPSBzdGFydGluZ19yb3dbcGFzc107XG4gICAgICAgICAgICB3aGlsZSAoY3IgPCBoKSB7XG4gICAgICAgICAgICAgICAgY3IgKz0gcmk7XG4gICAgICAgICAgICAgICAgc2grKztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciBjYyA9IHN0YXJ0aW5nX2NvbFtwYXNzXTtcbiAgICAgICAgICAgIHdoaWxlIChjYyA8IHcpIHtcbiAgICAgICAgICAgICAgICBjYyArPSBjaTtcbiAgICAgICAgICAgICAgICBzdysrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmFyIGJwbGwgPSBNYXRoLmNlaWwoc3cgKiBicHAgLyA4KTtcbiAgICAgICAgICAgIFVQTkcuZGVjb2RlLl9maWx0ZXJaZXJvKGRhdGEsIG91dCwgZGksIHN3LCBzaCk7XG5cbiAgICAgICAgICAgIHZhciB5ID0gMCxcbiAgICAgICAgICAgICAgICByb3cgPSBzdGFydGluZ19yb3dbcGFzc107XG4gICAgICAgICAgICB3aGlsZSAocm93IDwgaCkge1xuICAgICAgICAgICAgICAgIHZhciBjb2wgPSBzdGFydGluZ19jb2xbcGFzc107XG4gICAgICAgICAgICAgICAgdmFyIGNkaSA9IChkaSArIHkgKiBicGxsKSA8PCAzO1xuXG4gICAgICAgICAgICAgICAgd2hpbGUgKGNvbCA8IHcpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGJwcCA9PSAxKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgdmFsID0gZGF0YVtjZGkgPj4gM107XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWwgPSAodmFsID4+ICg3IC0gKGNkaSAmIDcpKSkgJiAxO1xuICAgICAgICAgICAgICAgICAgICAgICAgaW1nW3JvdyAqIGJwbCArIChjb2wgPj4gMyldIHw9ICh2YWwgPDwgKDcgLSAoKGNvbCAmIDMpIDw8IDApKSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgaWYgKGJwcCA9PSAyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgdmFsID0gZGF0YVtjZGkgPj4gM107XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWwgPSAodmFsID4+ICg2IC0gKGNkaSAmIDcpKSkgJiAzO1xuICAgICAgICAgICAgICAgICAgICAgICAgaW1nW3JvdyAqIGJwbCArIChjb2wgPj4gMildIHw9ICh2YWwgPDwgKDYgLSAoKGNvbCAmIDMpIDw8IDEpKSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgaWYgKGJwcCA9PSA0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgdmFsID0gZGF0YVtjZGkgPj4gM107XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWwgPSAodmFsID4+ICg0IC0gKGNkaSAmIDcpKSkgJiAxNTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGltZ1tyb3cgKiBicGwgKyAoY29sID4+IDEpXSB8PSAodmFsIDw8ICg0IC0gKChjb2wgJiAxKSA8PCAyKSkpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGlmIChicHAgPj0gOCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGlpID0gcm93ICogYnBsICsgY29sICogY2JwcDtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgY2JwcDsgaisrKSBpbWdbaWkgKyBqXSA9IGRhdGFbKGNkaSA+PiAzKSArIGpdO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGNkaSArPSBicHA7XG4gICAgICAgICAgICAgICAgICAgIGNvbCArPSBjaTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgeSsrO1xuICAgICAgICAgICAgICAgIHJvdyArPSByaTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChzdyAqIHNoICE9IDApIGRpICs9IHNoICogKDEgKyBicGxsKTtcbiAgICAgICAgICAgIHBhc3MgPSBwYXNzICsgMTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gaW1nO1xuICAgIH1cblxuICAgIFVQTkcuZGVjb2RlLl9nZXRCUFAgPSBmdW5jdGlvbiAob3V0KSB7XG4gICAgICAgIHZhciBub2MgPSBbMSwgbnVsbCwgMywgMSwgMiwgbnVsbCwgNF1bb3V0LmN0eXBlXTtcbiAgICAgICAgcmV0dXJuIG5vYyAqIG91dC5kZXB0aDtcbiAgICB9XG5cbiAgICBVUE5HLmRlY29kZS5fZmlsdGVyWmVybyA9IGZ1bmN0aW9uIChkYXRhLCBvdXQsIG9mZiwgdywgaCkge1xuICAgICAgICB2YXIgYnBwID0gVVBORy5kZWNvZGUuX2dldEJQUChvdXQpLFxuICAgICAgICAgICAgYnBsID0gTWF0aC5jZWlsKHcgKiBicHAgLyA4KSxcbiAgICAgICAgICAgIHBhZXRoID0gVVBORy5kZWNvZGUuX3BhZXRoO1xuICAgICAgICBicHAgPSBNYXRoLmNlaWwoYnBwIC8gOCk7XG5cbiAgICAgICAgZm9yICh2YXIgeSA9IDA7IHkgPCBoOyB5KyspIHtcbiAgICAgICAgICAgIHZhciBpID0gb2ZmICsgeSAqIGJwbCxcbiAgICAgICAgICAgICAgICBkaSA9IGkgKyB5ICsgMTtcbiAgICAgICAgICAgIHZhciB0eXBlID0gZGF0YVtkaSAtIDFdO1xuXG4gICAgICAgICAgICBpZiAodHlwZSA9PSAwKVxuICAgICAgICAgICAgICAgIGZvciAodmFyIHggPSAwOyB4IDwgYnBsOyB4KyspIGRhdGFbaSArIHhdID0gZGF0YVtkaSArIHhdO1xuICAgICAgICAgICAgZWxzZSBpZiAodHlwZSA9PSAxKSB7XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgeCA9IDA7IHggPCBicHA7IHgrKykgZGF0YVtpICsgeF0gPSBkYXRhW2RpICsgeF07XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgeCA9IGJwcDsgeCA8IGJwbDsgeCsrKSBkYXRhW2kgKyB4XSA9IChkYXRhW2RpICsgeF0gKyBkYXRhW2kgKyB4IC0gYnBwXSkgJiAyNTU7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHkgPT0gMCkge1xuICAgICAgICAgICAgICAgIGZvciAodmFyIHggPSAwOyB4IDwgYnBwOyB4KyspIGRhdGFbaSArIHhdID0gZGF0YVtkaSArIHhdO1xuICAgICAgICAgICAgICAgIGlmICh0eXBlID09IDIpXG4gICAgICAgICAgICAgICAgICAgIGZvciAodmFyIHggPSBicHA7IHggPCBicGw7IHgrKykgZGF0YVtpICsgeF0gPSAoZGF0YVtkaSArIHhdKSAmIDI1NTtcbiAgICAgICAgICAgICAgICBpZiAodHlwZSA9PSAzKVxuICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciB4ID0gYnBwOyB4IDwgYnBsOyB4KyspIGRhdGFbaSArIHhdID0gKGRhdGFbZGkgKyB4XSArIChkYXRhW2kgKyB4IC0gYnBwXSA+PiAxKSkgJiAyNTU7XG4gICAgICAgICAgICAgICAgaWYgKHR5cGUgPT0gNClcbiAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIgeCA9IGJwcDsgeCA8IGJwbDsgeCsrKSBkYXRhW2kgKyB4XSA9IChkYXRhW2RpICsgeF0gKyBwYWV0aChkYXRhW2kgKyB4IC0gYnBwXSwgMCwgMCkpICYgMjU1O1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBpZiAodHlwZSA9PSAyKSB7XG4gICAgICAgICAgICAgICAgICAgIGZvciAodmFyIHggPSAwOyB4IDwgYnBsOyB4KyspIGRhdGFbaSArIHhdID0gKGRhdGFbZGkgKyB4XSArIGRhdGFbaSArIHggLSBicGxdKSAmIDI1NTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAodHlwZSA9PSAzKSB7XG4gICAgICAgICAgICAgICAgICAgIGZvciAodmFyIHggPSAwOyB4IDwgYnBwOyB4KyspIGRhdGFbaSArIHhdID0gKGRhdGFbZGkgKyB4XSArIChkYXRhW2kgKyB4IC0gYnBsXSA+PiAxKSkgJiAyNTU7XG4gICAgICAgICAgICAgICAgICAgIGZvciAodmFyIHggPSBicHA7IHggPCBicGw7IHgrKykgZGF0YVtpICsgeF0gPSAoZGF0YVtkaSArIHhdICsgKChkYXRhW2kgKyB4IC0gYnBsXSArIGRhdGFbaSArIHggLSBicHBdKSA+PiAxKSkgJiAyNTU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKHR5cGUgPT0gNCkge1xuICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciB4ID0gMDsgeCA8IGJwcDsgeCsrKSBkYXRhW2kgKyB4XSA9IChkYXRhW2RpICsgeF0gKyBwYWV0aCgwLCBkYXRhW2kgKyB4IC0gYnBsXSwgMCkpICYgMjU1O1xuICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciB4ID0gYnBwOyB4IDwgYnBsOyB4KyspIGRhdGFbaSArIHhdID0gKGRhdGFbZGkgKyB4XSArIHBhZXRoKGRhdGFbaSArIHggLSBicHBdLCBkYXRhW2kgKyB4IC0gYnBsXSwgZGF0YVtpICsgeCAtIGJwcCAtIGJwbF0pKSAmIDI1NTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGRhdGE7XG4gICAgfVxuXG4gICAgVVBORy5kZWNvZGUuX3BhZXRoID0gZnVuY3Rpb24gKGEsIGIsIGMpIHtcbiAgICAgICAgdmFyIHAgPSBhICsgYiAtIGMsXG4gICAgICAgICAgICBwYSA9IE1hdGguYWJzKHAgLSBhKSxcbiAgICAgICAgICAgIHBiID0gTWF0aC5hYnMocCAtIGIpLFxuICAgICAgICAgICAgcGMgPSBNYXRoLmFicyhwIC0gYyk7XG4gICAgICAgIGlmIChwYSA8PSBwYiAmJiBwYSA8PSBwYykgcmV0dXJuIGE7XG4gICAgICAgIGVsc2UgaWYgKHBiIDw9IHBjKSByZXR1cm4gYjtcbiAgICAgICAgcmV0dXJuIGM7XG4gICAgfVxuXG4gICAgVVBORy5kZWNvZGUuX0lIRFIgPSBmdW5jdGlvbiAoZGF0YSwgb2Zmc2V0LCBvdXQpIHtcbiAgICAgICAgdmFyIGJpbiA9IFVQTkcuX2JpbjtcbiAgICAgICAgb3V0LndpZHRoID0gYmluLnJlYWRVaW50KGRhdGEsIG9mZnNldCk7XG4gICAgICAgIG9mZnNldCArPSA0O1xuICAgICAgICBvdXQuaGVpZ2h0ID0gYmluLnJlYWRVaW50KGRhdGEsIG9mZnNldCk7XG4gICAgICAgIG9mZnNldCArPSA0O1xuICAgICAgICBvdXQuZGVwdGggPSBkYXRhW29mZnNldF07XG4gICAgICAgIG9mZnNldCsrO1xuICAgICAgICBvdXQuY3R5cGUgPSBkYXRhW29mZnNldF07XG4gICAgICAgIG9mZnNldCsrO1xuICAgICAgICBvdXQuY29tcHJlc3MgPSBkYXRhW29mZnNldF07XG4gICAgICAgIG9mZnNldCsrO1xuICAgICAgICBvdXQuZmlsdGVyID0gZGF0YVtvZmZzZXRdO1xuICAgICAgICBvZmZzZXQrKztcbiAgICAgICAgb3V0LmludGVybGFjZSA9IGRhdGFbb2Zmc2V0XTtcbiAgICAgICAgb2Zmc2V0Kys7XG4gICAgfVxuXG4gICAgVVBORy5fYmluID0ge1xuICAgICAgICBuZXh0WmVybzogZnVuY3Rpb24gKGRhdGEsIHApIHtcbiAgICAgICAgICAgIHdoaWxlIChkYXRhW3BdICE9IDApIHArKztcbiAgICAgICAgICAgIHJldHVybiBwO1xuICAgICAgICB9LFxuICAgICAgICByZWFkVXNob3J0OiBmdW5jdGlvbiAoYnVmZiwgcCkge1xuICAgICAgICAgICAgcmV0dXJuIChidWZmW3BdIDw8IDgpIHwgYnVmZltwICsgMV07XG4gICAgICAgIH0sXG4gICAgICAgIHdyaXRlVXNob3J0OiBmdW5jdGlvbiAoYnVmZiwgcCwgbikge1xuICAgICAgICAgICAgYnVmZltwXSA9IChuID4+IDgpICYgMjU1O1xuICAgICAgICAgICAgYnVmZltwICsgMV0gPSBuICYgMjU1O1xuICAgICAgICB9LFxuICAgICAgICByZWFkVWludDogZnVuY3Rpb24gKGJ1ZmYsIHApIHtcbiAgICAgICAgICAgIHJldHVybiAoYnVmZltwXSAqICgyNTYgKiAyNTYgKiAyNTYpKSArICgoYnVmZltwICsgMV0gPDwgMTYpIHwgKGJ1ZmZbcCArIDJdIDw8IDgpIHwgYnVmZltwICsgM10pO1xuICAgICAgICB9LFxuICAgICAgICB3cml0ZVVpbnQ6IGZ1bmN0aW9uIChidWZmLCBwLCBuKSB7XG4gICAgICAgICAgICBidWZmW3BdID0gKG4gPj4gMjQpICYgMjU1O1xuICAgICAgICAgICAgYnVmZltwICsgMV0gPSAobiA+PiAxNikgJiAyNTU7XG4gICAgICAgICAgICBidWZmW3AgKyAyXSA9IChuID4+IDgpICYgMjU1O1xuICAgICAgICAgICAgYnVmZltwICsgM10gPSBuICYgMjU1O1xuICAgICAgICB9LFxuICAgICAgICByZWFkQVNDSUk6IGZ1bmN0aW9uIChidWZmLCBwLCBsKSB7XG4gICAgICAgICAgICB2YXIgcyA9IFwiXCI7XG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGw7IGkrKykgcyArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZmZbcCArIGldKTtcbiAgICAgICAgICAgIHJldHVybiBzO1xuICAgICAgICB9LFxuICAgICAgICB3cml0ZUFTQ0lJOiBmdW5jdGlvbiAoZGF0YSwgcCwgcykge1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzLmxlbmd0aDsgaSsrKSBkYXRhW3AgKyBpXSA9IHMuY2hhckNvZGVBdChpKTtcbiAgICAgICAgfSxcbiAgICAgICAgcmVhZEJ5dGVzOiBmdW5jdGlvbiAoYnVmZiwgcCwgbCkge1xuICAgICAgICAgICAgdmFyIGFyciA9IFtdO1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsOyBpKyspIGFyci5wdXNoKGJ1ZmZbcCArIGldKTtcbiAgICAgICAgICAgIHJldHVybiBhcnI7XG4gICAgICAgIH0sXG4gICAgICAgIHBhZDogZnVuY3Rpb24gKG4pIHtcbiAgICAgICAgICAgIHJldHVybiBuLmxlbmd0aCA8IDIgPyBcIjBcIiArIG4gOiBuO1xuICAgICAgICB9LFxuICAgICAgICByZWFkVVRGODogZnVuY3Rpb24gKGJ1ZmYsIHAsIGwpIHtcbiAgICAgICAgICAgIHZhciBzID0gXCJcIixcbiAgICAgICAgICAgICAgICBucztcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbDsgaSsrKSBzICs9IFwiJVwiICsgVVBORy5fYmluLnBhZChidWZmW3AgKyBpXS50b1N0cmluZygxNikpO1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBucyA9IGRlY29kZVVSSUNvbXBvbmVudChzKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gVVBORy5fYmluLnJlYWRBU0NJSShidWZmLCBwLCBsKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBucztcbiAgICAgICAgfVxuICAgIH1cbiAgICBVUE5HLl9jb3B5VGlsZSA9IGZ1bmN0aW9uIChzYiwgc3csIHNoLCB0YiwgdHcsIHRoLCB4b2ZmLCB5b2ZmLCBtb2RlKSB7XG4gICAgICAgIHZhciB3ID0gTWF0aC5taW4oc3csIHR3KSxcbiAgICAgICAgICAgIGggPSBNYXRoLm1pbihzaCwgdGgpO1xuICAgICAgICB2YXIgc2kgPSAwLFxuICAgICAgICAgICAgdGkgPSAwO1xuICAgICAgICBmb3IgKHZhciB5ID0gMDsgeSA8IGg7IHkrKylcbiAgICAgICAgICAgIGZvciAodmFyIHggPSAwOyB4IDwgdzsgeCsrKSB7XG4gICAgICAgICAgICAgICAgaWYgKHhvZmYgPj0gMCAmJiB5b2ZmID49IDApIHtcbiAgICAgICAgICAgICAgICAgICAgc2kgPSAoeSAqIHN3ICsgeCkgPDwgMjtcbiAgICAgICAgICAgICAgICAgICAgdGkgPSAoKHlvZmYgKyB5KSAqIHR3ICsgeG9mZiArIHgpIDw8IDI7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgc2kgPSAoKC15b2ZmICsgeSkgKiBzdyAtIHhvZmYgKyB4KSA8PCAyO1xuICAgICAgICAgICAgICAgICAgICB0aSA9ICh5ICogdHcgKyB4KSA8PCAyO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChtb2RlID09IDApIHtcbiAgICAgICAgICAgICAgICAgICAgdGJbdGldID0gc2Jbc2ldO1xuICAgICAgICAgICAgICAgICAgICB0Ylt0aSArIDFdID0gc2Jbc2kgKyAxXTtcbiAgICAgICAgICAgICAgICAgICAgdGJbdGkgKyAyXSA9IHNiW3NpICsgMl07XG4gICAgICAgICAgICAgICAgICAgIHRiW3RpICsgM10gPSBzYltzaSArIDNdO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAobW9kZSA9PSAxKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBmYSA9IHNiW3NpICsgM10gKiAoMSAvIDI1NSksXG4gICAgICAgICAgICAgICAgICAgICAgICBmciA9IHNiW3NpXSAqIGZhLFxuICAgICAgICAgICAgICAgICAgICAgICAgZmcgPSBzYltzaSArIDFdICogZmEsXG4gICAgICAgICAgICAgICAgICAgICAgICBmYiA9IHNiW3NpICsgMl0gKiBmYTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGJhID0gdGJbdGkgKyAzXSAqICgxIC8gMjU1KSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyID0gdGJbdGldICogYmEsXG4gICAgICAgICAgICAgICAgICAgICAgICBiZyA9IHRiW3RpICsgMV0gKiBiYSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGJiID0gdGJbdGkgKyAyXSAqIGJhO1xuXG4gICAgICAgICAgICAgICAgICAgIHZhciBpZmEgPSAxIC0gZmEsXG4gICAgICAgICAgICAgICAgICAgICAgICBvYSA9IGZhICsgYmEgKiBpZmEsXG4gICAgICAgICAgICAgICAgICAgICAgICBpb2EgPSAob2EgPT0gMCA/IDAgOiAxIC8gb2EpO1xuICAgICAgICAgICAgICAgICAgICB0Ylt0aSArIDNdID0gMjU1ICogb2E7XG4gICAgICAgICAgICAgICAgICAgIHRiW3RpICsgMF0gPSAoZnIgKyBiciAqIGlmYSkgKiBpb2E7XG4gICAgICAgICAgICAgICAgICAgIHRiW3RpICsgMV0gPSAoZmcgKyBiZyAqIGlmYSkgKiBpb2E7XG4gICAgICAgICAgICAgICAgICAgIHRiW3RpICsgMl0gPSAoZmIgKyBiYiAqIGlmYSkgKiBpb2E7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChtb2RlID09IDIpIHsgLy8gY29weSBvbmx5IGRpZmZlcmVuY2VzLCBvdGhlcndpc2UgemVyb1xuICAgICAgICAgICAgICAgICAgICB2YXIgZmEgPSBzYltzaSArIDNdLFxuICAgICAgICAgICAgICAgICAgICAgICAgZnIgPSBzYltzaV0sXG4gICAgICAgICAgICAgICAgICAgICAgICBmZyA9IHNiW3NpICsgMV0sXG4gICAgICAgICAgICAgICAgICAgICAgICBmYiA9IHNiW3NpICsgMl07XG4gICAgICAgICAgICAgICAgICAgIHZhciBiYSA9IHRiW3RpICsgM10sXG4gICAgICAgICAgICAgICAgICAgICAgICBiciA9IHRiW3RpXSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGJnID0gdGJbdGkgKyAxXSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGJiID0gdGJbdGkgKyAyXTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZhID09IGJhICYmIGZyID09IGJyICYmIGZnID09IGJnICYmIGZiID09IGJiKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0Ylt0aV0gPSAwO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGJbdGkgKyAxXSA9IDA7XG4gICAgICAgICAgICAgICAgICAgICAgICB0Ylt0aSArIDJdID0gMDtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRiW3RpICsgM10gPSAwO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGJbdGldID0gZnI7XG4gICAgICAgICAgICAgICAgICAgICAgICB0Ylt0aSArIDFdID0gZmc7XG4gICAgICAgICAgICAgICAgICAgICAgICB0Ylt0aSArIDJdID0gZmI7XG4gICAgICAgICAgICAgICAgICAgICAgICB0Ylt0aSArIDNdID0gZmE7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKG1vZGUgPT0gMykgeyAvLyBjaGVjayBpZiBjYW4gYmUgYmxlbmRlZFxuICAgICAgICAgICAgICAgICAgICB2YXIgZmEgPSBzYltzaSArIDNdLFxuICAgICAgICAgICAgICAgICAgICAgICAgZnIgPSBzYltzaV0sXG4gICAgICAgICAgICAgICAgICAgICAgICBmZyA9IHNiW3NpICsgMV0sXG4gICAgICAgICAgICAgICAgICAgICAgICBmYiA9IHNiW3NpICsgMl07XG4gICAgICAgICAgICAgICAgICAgIHZhciBiYSA9IHRiW3RpICsgM10sXG4gICAgICAgICAgICAgICAgICAgICAgICBiciA9IHRiW3RpXSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGJnID0gdGJbdGkgKyAxXSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGJiID0gdGJbdGkgKyAyXTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZhID09IGJhICYmIGZyID09IGJyICYmIGZnID09IGJnICYmIGZiID09IGJiKSBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgLy9pZihmYSE9MjU1ICYmIGJhIT0wKSByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIGlmIChmYSA8IDIyMCAmJiBiYSA+IDIwKSByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBVUE5HLmVuY29kZSA9IGZ1bmN0aW9uIChidWZzLCB3LCBoLCBwcywgZGVscywgZm9yYmlkUGx0ZSkge1xuICAgICAgICBpZiAocHMgPT0gbnVsbCkgcHMgPSAwO1xuICAgICAgICBpZiAoZm9yYmlkUGx0ZSA9PSBudWxsKSBmb3JiaWRQbHRlID0gZmFsc2U7XG5cbiAgICAgICAgdmFyIG5pbWcgPSBVUE5HLmVuY29kZS5jb21wcmVzcyhidWZzLCB3LCBoLCBwcywgZmFsc2UsIGZvcmJpZFBsdGUpO1xuICAgICAgICBVUE5HLmVuY29kZS5jb21wcmVzc1BORyhuaW1nLCAtMSk7XG5cbiAgICAgICAgcmV0dXJuIFVQTkcuZW5jb2RlLl9tYWluKG5pbWcsIHcsIGgsIGRlbHMpO1xuICAgIH1cblxuICAgIFVQTkcuZW5jb2RlTEwgPSBmdW5jdGlvbiAoYnVmcywgdywgaCwgY2MsIGFjLCBkZXB0aCwgZGVscykge1xuICAgICAgICB2YXIgbmltZyA9IHtcbiAgICAgICAgICAgIGN0eXBlOiAwICsgKGNjID09IDEgPyAwIDogMikgKyAoYWMgPT0gMCA/IDAgOiA0KSxcbiAgICAgICAgICAgIGRlcHRoOiBkZXB0aCxcbiAgICAgICAgICAgIGZyYW1lczogW11cbiAgICAgICAgfTtcblxuICAgICAgICB2YXIgYmlwcCA9IChjYyArIGFjKSAqIGRlcHRoLFxuICAgICAgICAgICAgYmlwbCA9IGJpcHAgKiB3O1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGJ1ZnMubGVuZ3RoOyBpKyspIG5pbWcuZnJhbWVzLnB1c2goe1xuICAgICAgICAgICAgcmVjdDoge1xuICAgICAgICAgICAgICAgIHg6IDAsXG4gICAgICAgICAgICAgICAgeTogMCxcbiAgICAgICAgICAgICAgICB3aWR0aDogdyxcbiAgICAgICAgICAgICAgICBoZWlnaHQ6IGhcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBpbWc6IG5ldyBVaW50OEFycmF5KGJ1ZnNbaV0pLFxuICAgICAgICAgICAgYmxlbmQ6IDAsXG4gICAgICAgICAgICBkaXNwb3NlOiAxLFxuICAgICAgICAgICAgYnBwOiBNYXRoLmNlaWwoYmlwcCAvIDgpLFxuICAgICAgICAgICAgYnBsOiBNYXRoLmNlaWwoYmlwbCAvIDgpXG4gICAgICAgIH0pO1xuXG4gICAgICAgIFVQTkcuZW5jb2RlLmNvbXByZXNzUE5HKG5pbWcsIDQpO1xuXG4gICAgICAgIHJldHVybiBVUE5HLmVuY29kZS5fbWFpbihuaW1nLCB3LCBoLCBkZWxzKTtcbiAgICB9XG5cbiAgICBVUE5HLmVuY29kZS5fbWFpbiA9IGZ1bmN0aW9uIChuaW1nLCB3LCBoLCBkZWxzKSB7XG4gICAgICAgIHZhciBjcmMgPSBVUE5HLmNyYy5jcmMsXG4gICAgICAgICAgICB3VWkgPSBVUE5HLl9iaW4ud3JpdGVVaW50LFxuICAgICAgICAgICAgd1VzID0gVVBORy5fYmluLndyaXRlVXNob3J0LFxuICAgICAgICAgICAgd0FzID0gVVBORy5fYmluLndyaXRlQVNDSUk7XG4gICAgICAgIHZhciBvZmZzZXQgPSA4LFxuICAgICAgICAgICAgYW5pbSA9IG5pbWcuZnJhbWVzLmxlbmd0aCA+IDEsXG4gICAgICAgICAgICBwbHRBbHBoYSA9IGZhbHNlO1xuXG4gICAgICAgIHZhciBsZW5nID0gOCArICgxNiArIDUgKyA0KSArICg5ICsgNCkgKyAoYW5pbSA/IDIwIDogMCk7XG4gICAgICAgIGlmIChuaW1nLmN0eXBlID09IDMpIHtcbiAgICAgICAgICAgIHZhciBkbCA9IG5pbWcucGx0ZS5sZW5ndGg7XG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGRsOyBpKyspXG4gICAgICAgICAgICAgICAgaWYgKChuaW1nLnBsdGVbaV0gPj4+IDI0KSAhPSAyNTUpIHBsdEFscGhhID0gdHJ1ZTtcbiAgICAgICAgICAgIGxlbmcgKz0gKDggKyBkbCAqIDMgKyA0KSArIChwbHRBbHBoYSA/ICg4ICsgZGwgKiAxICsgNCkgOiAwKTtcbiAgICAgICAgfVxuICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IG5pbWcuZnJhbWVzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgICB2YXIgZnIgPSBuaW1nLmZyYW1lc1tqXTtcbiAgICAgICAgICAgIGlmIChhbmltKSBsZW5nICs9IDM4O1xuICAgICAgICAgICAgbGVuZyArPSBmci5jaW1nLmxlbmd0aCArIDEyO1xuICAgICAgICAgICAgaWYgKGogIT0gMCkgbGVuZyArPSA0O1xuICAgICAgICB9XG4gICAgICAgIGxlbmcgKz0gMTI7XG5cbiAgICAgICAgdmFyIGRhdGEgPSBuZXcgVWludDhBcnJheShsZW5nKTtcbiAgICAgICAgdmFyIHdyID0gWzB4ODksIDB4NTAsIDB4NGUsIDB4NDcsIDB4MGQsIDB4MGEsIDB4MWEsIDB4MGFdO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IDg7IGkrKykgZGF0YVtpXSA9IHdyW2ldO1xuXG4gICAgICAgIHdVaShkYXRhLCBvZmZzZXQsIDEzKTtcbiAgICAgICAgb2Zmc2V0ICs9IDQ7XG4gICAgICAgIHdBcyhkYXRhLCBvZmZzZXQsIFwiSUhEUlwiKTtcbiAgICAgICAgb2Zmc2V0ICs9IDQ7XG4gICAgICAgIHdVaShkYXRhLCBvZmZzZXQsIHcpO1xuICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgd1VpKGRhdGEsIG9mZnNldCwgaCk7XG4gICAgICAgIG9mZnNldCArPSA0O1xuICAgICAgICBkYXRhW29mZnNldF0gPSBuaW1nLmRlcHRoO1xuICAgICAgICBvZmZzZXQrKzsgLy8gZGVwdGhcbiAgICAgICAgZGF0YVtvZmZzZXRdID0gbmltZy5jdHlwZTtcbiAgICAgICAgb2Zmc2V0Kys7IC8vIGN0eXBlXG4gICAgICAgIGRhdGFbb2Zmc2V0XSA9IDA7XG4gICAgICAgIG9mZnNldCsrOyAvLyBjb21wcmVzc1xuICAgICAgICBkYXRhW29mZnNldF0gPSAwO1xuICAgICAgICBvZmZzZXQrKzsgLy8gZmlsdGVyXG4gICAgICAgIGRhdGFbb2Zmc2V0XSA9IDA7XG4gICAgICAgIG9mZnNldCsrOyAvLyBpbnRlcmxhY2VcbiAgICAgICAgd1VpKGRhdGEsIG9mZnNldCwgY3JjKGRhdGEsIG9mZnNldCAtIDE3LCAxNykpO1xuICAgICAgICBvZmZzZXQgKz0gNDsgLy8gY3JjXG4gICAgICAgIC8vIDkgYnl0ZXMgdG8gc2F5LCB0aGF0IGl0IGlzIHNSR0JcbiAgICAgICAgd1VpKGRhdGEsIG9mZnNldCwgMSk7XG4gICAgICAgIG9mZnNldCArPSA0O1xuICAgICAgICB3QXMoZGF0YSwgb2Zmc2V0LCBcInNSR0JcIik7XG4gICAgICAgIG9mZnNldCArPSA0O1xuICAgICAgICBkYXRhW29mZnNldF0gPSAxO1xuICAgICAgICBvZmZzZXQrKztcbiAgICAgICAgd1VpKGRhdGEsIG9mZnNldCwgY3JjKGRhdGEsIG9mZnNldCAtIDUsIDUpKTtcbiAgICAgICAgb2Zmc2V0ICs9IDQ7IC8vIGNyY1xuICAgICAgICBpZiAoYW5pbSkge1xuICAgICAgICAgICAgd1VpKGRhdGEsIG9mZnNldCwgOCk7XG4gICAgICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgICAgIHdBcyhkYXRhLCBvZmZzZXQsIFwiYWNUTFwiKTtcbiAgICAgICAgICAgIG9mZnNldCArPSA0O1xuICAgICAgICAgICAgd1VpKGRhdGEsIG9mZnNldCwgbmltZy5mcmFtZXMubGVuZ3RoKTtcbiAgICAgICAgICAgIG9mZnNldCArPSA0O1xuICAgICAgICAgICAgd1VpKGRhdGEsIG9mZnNldCwgMCk7XG4gICAgICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgICAgIHdVaShkYXRhLCBvZmZzZXQsIGNyYyhkYXRhLCBvZmZzZXQgLSAxMiwgMTIpKTtcbiAgICAgICAgICAgIG9mZnNldCArPSA0OyAvLyBjcmNcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChuaW1nLmN0eXBlID09IDMpIHtcbiAgICAgICAgICAgIHZhciBkbCA9IG5pbWcucGx0ZS5sZW5ndGg7XG4gICAgICAgICAgICB3VWkoZGF0YSwgb2Zmc2V0LCBkbCAqIDMpO1xuICAgICAgICAgICAgb2Zmc2V0ICs9IDQ7XG4gICAgICAgICAgICB3QXMoZGF0YSwgb2Zmc2V0LCBcIlBMVEVcIik7XG4gICAgICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZGw7IGkrKykge1xuICAgICAgICAgICAgICAgIHZhciB0aSA9IGkgKiAzLFxuICAgICAgICAgICAgICAgICAgICBjID0gbmltZy5wbHRlW2ldLFxuICAgICAgICAgICAgICAgICAgICByID0gKGMpICYgMjU1LFxuICAgICAgICAgICAgICAgICAgICBnID0gKGMgPj4+IDgpICYgMjU1LFxuICAgICAgICAgICAgICAgICAgICBiID0gKGMgPj4+IDE2KSAmIDI1NTtcbiAgICAgICAgICAgICAgICBkYXRhW29mZnNldCArIHRpICsgMF0gPSByO1xuICAgICAgICAgICAgICAgIGRhdGFbb2Zmc2V0ICsgdGkgKyAxXSA9IGc7XG4gICAgICAgICAgICAgICAgZGF0YVtvZmZzZXQgKyB0aSArIDJdID0gYjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG9mZnNldCArPSBkbCAqIDM7XG4gICAgICAgICAgICB3VWkoZGF0YSwgb2Zmc2V0LCBjcmMoZGF0YSwgb2Zmc2V0IC0gZGwgKiAzIC0gNCwgZGwgKiAzICsgNCkpO1xuICAgICAgICAgICAgb2Zmc2V0ICs9IDQ7IC8vIGNyY1xuICAgICAgICAgICAgaWYgKHBsdEFscGhhKSB7XG4gICAgICAgICAgICAgICAgd1VpKGRhdGEsIG9mZnNldCwgZGwpO1xuICAgICAgICAgICAgICAgIG9mZnNldCArPSA0O1xuICAgICAgICAgICAgICAgIHdBcyhkYXRhLCBvZmZzZXQsIFwidFJOU1wiKTtcbiAgICAgICAgICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGRsOyBpKyspIGRhdGFbb2Zmc2V0ICsgaV0gPSAobmltZy5wbHRlW2ldID4+PiAyNCkgJiAyNTU7XG4gICAgICAgICAgICAgICAgb2Zmc2V0ICs9IGRsO1xuICAgICAgICAgICAgICAgIHdVaShkYXRhLCBvZmZzZXQsIGNyYyhkYXRhLCBvZmZzZXQgLSBkbCAtIDQsIGRsICsgNCkpO1xuICAgICAgICAgICAgICAgIG9mZnNldCArPSA0OyAvLyBjcmNcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBmaSA9IDA7XG4gICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgbmltZy5mcmFtZXMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICAgIHZhciBmciA9IG5pbWcuZnJhbWVzW2pdO1xuICAgICAgICAgICAgaWYgKGFuaW0pIHtcbiAgICAgICAgICAgICAgICB3VWkoZGF0YSwgb2Zmc2V0LCAyNik7XG4gICAgICAgICAgICAgICAgb2Zmc2V0ICs9IDQ7XG4gICAgICAgICAgICAgICAgd0FzKGRhdGEsIG9mZnNldCwgXCJmY1RMXCIpO1xuICAgICAgICAgICAgICAgIG9mZnNldCArPSA0O1xuICAgICAgICAgICAgICAgIHdVaShkYXRhLCBvZmZzZXQsIGZpKyspO1xuICAgICAgICAgICAgICAgIG9mZnNldCArPSA0O1xuICAgICAgICAgICAgICAgIHdVaShkYXRhLCBvZmZzZXQsIGZyLnJlY3Qud2lkdGgpO1xuICAgICAgICAgICAgICAgIG9mZnNldCArPSA0O1xuICAgICAgICAgICAgICAgIHdVaShkYXRhLCBvZmZzZXQsIGZyLnJlY3QuaGVpZ2h0KTtcbiAgICAgICAgICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgICAgICAgICB3VWkoZGF0YSwgb2Zmc2V0LCBmci5yZWN0LngpO1xuICAgICAgICAgICAgICAgIG9mZnNldCArPSA0O1xuICAgICAgICAgICAgICAgIHdVaShkYXRhLCBvZmZzZXQsIGZyLnJlY3QueSk7XG4gICAgICAgICAgICAgICAgb2Zmc2V0ICs9IDQ7XG4gICAgICAgICAgICAgICAgd1VzKGRhdGEsIG9mZnNldCwgZGVsc1tqXSk7XG4gICAgICAgICAgICAgICAgb2Zmc2V0ICs9IDI7XG4gICAgICAgICAgICAgICAgd1VzKGRhdGEsIG9mZnNldCwgMTAwMCk7XG4gICAgICAgICAgICAgICAgb2Zmc2V0ICs9IDI7XG4gICAgICAgICAgICAgICAgZGF0YVtvZmZzZXRdID0gZnIuZGlzcG9zZTtcbiAgICAgICAgICAgICAgICBvZmZzZXQrKzsgLy8gZGlzcG9zZVxuICAgICAgICAgICAgICAgIGRhdGFbb2Zmc2V0XSA9IGZyLmJsZW5kO1xuICAgICAgICAgICAgICAgIG9mZnNldCsrOyAvLyBibGVuZFxuICAgICAgICAgICAgICAgIHdVaShkYXRhLCBvZmZzZXQsIGNyYyhkYXRhLCBvZmZzZXQgLSAzMCwgMzApKTtcbiAgICAgICAgICAgICAgICBvZmZzZXQgKz0gNDsgLy8gY3JjXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBpbWdkID0gZnIuY2ltZyxcbiAgICAgICAgICAgICAgICBkbCA9IGltZ2QubGVuZ3RoO1xuICAgICAgICAgICAgd1VpKGRhdGEsIG9mZnNldCwgZGwgKyAoaiA9PSAwID8gMCA6IDQpKTtcbiAgICAgICAgICAgIG9mZnNldCArPSA0O1xuICAgICAgICAgICAgdmFyIGlvZmYgPSBvZmZzZXQ7XG4gICAgICAgICAgICB3QXMoZGF0YSwgb2Zmc2V0LCAoaiA9PSAwKSA/IFwiSURBVFwiIDogXCJmZEFUXCIpO1xuICAgICAgICAgICAgb2Zmc2V0ICs9IDQ7XG4gICAgICAgICAgICBpZiAoaiAhPSAwKSB7XG4gICAgICAgICAgICAgICAgd1VpKGRhdGEsIG9mZnNldCwgZmkrKyk7XG4gICAgICAgICAgICAgICAgb2Zmc2V0ICs9IDQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGRsOyBpKyspIGRhdGFbb2Zmc2V0ICsgaV0gPSBpbWdkW2ldO1xuICAgICAgICAgICAgb2Zmc2V0ICs9IGRsO1xuICAgICAgICAgICAgd1VpKGRhdGEsIG9mZnNldCwgY3JjKGRhdGEsIGlvZmYsIG9mZnNldCAtIGlvZmYpKTtcbiAgICAgICAgICAgIG9mZnNldCArPSA0OyAvLyBjcmNcbiAgICAgICAgfVxuXG4gICAgICAgIHdVaShkYXRhLCBvZmZzZXQsIDApO1xuICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgd0FzKGRhdGEsIG9mZnNldCwgXCJJRU5EXCIpO1xuICAgICAgICBvZmZzZXQgKz0gNDtcbiAgICAgICAgd1VpKGRhdGEsIG9mZnNldCwgY3JjKGRhdGEsIG9mZnNldCAtIDQsIDQpKTtcbiAgICAgICAgb2Zmc2V0ICs9IDQ7IC8vIGNyY1xuICAgICAgICByZXR1cm4gZGF0YS5idWZmZXI7XG4gICAgfVxuXG4gICAgVVBORy5lbmNvZGUuY29tcHJlc3NQTkcgPSBmdW5jdGlvbiAob3V0LCBmaWx0ZXIpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBvdXQuZnJhbWVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgZnJtID0gb3V0LmZyYW1lc1tpXSxcbiAgICAgICAgICAgICAgICBudyA9IGZybS5yZWN0LndpZHRoLFxuICAgICAgICAgICAgICAgIG5oID0gZnJtLnJlY3QuaGVpZ2h0O1xuICAgICAgICAgICAgdmFyIGZkYXRhID0gbmV3IFVpbnQ4QXJyYXkobmggKiBmcm0uYnBsICsgbmgpO1xuICAgICAgICAgICAgZnJtLmNpbWcgPSBVUE5HLmVuY29kZS5fZmlsdGVyWmVybyhmcm0uaW1nLCBuaCwgZnJtLmJwcCwgZnJtLmJwbCwgZmRhdGEsIGZpbHRlcik7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBVUE5HLmVuY29kZS5jb21wcmVzcyA9IGZ1bmN0aW9uIChidWZzLCB3LCBoLCBwcywgZm9yR0lGLCBmb3JiaWRQbHRlKSB7XG4gICAgICAgIC8vdmFyIHRpbWUgPSBEYXRlLm5vdygpO1xuICAgICAgICBpZiAoZm9yYmlkUGx0ZSA9PSBudWxsKSBmb3JiaWRQbHRlID0gZmFsc2U7XG5cbiAgICAgICAgdmFyIGN0eXBlID0gNixcbiAgICAgICAgICAgIGRlcHRoID0gOCxcbiAgICAgICAgICAgIGFscGhhQW5kID0gMjU1XG5cbiAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBidWZzLmxlbmd0aDsgaisrKSB7IC8vIHdoZW4gbm90IHF1YW50aXplZCwgb3RoZXIgZnJhbWVzIGNhbiBjb250YWluIGNvbG9ycywgdGhhdCBhcmUgbm90IGluIGFuIGluaXRpYWwgZnJhbWVcbiAgICAgICAgICAgIHZhciBpbWcgPSBuZXcgVWludDhBcnJheShidWZzW2pdKSxcbiAgICAgICAgICAgICAgICBpbGVuID0gaW1nLmxlbmd0aDtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgaWxlbjsgaSArPSA0KSBhbHBoYUFuZCAmPSBpbWdbaSArIDNdO1xuICAgICAgICB9XG4gICAgICAgIHZhciBnb3RBbHBoYSA9IChhbHBoYUFuZCAhPSAyNTUpO1xuXG4gICAgICAgIC8vY29uc29sZS5sb2coXCJhbHBoYSBjaGVja1wiLCBEYXRlLm5vdygpLXRpbWUpOyAgdGltZSA9IERhdGUubm93KCk7XG4gICAgICAgIHZhciBicnV0ZSA9IGdvdEFscGhhICYmIGZvckdJRjsgLy8gYnJ1dGUgOiBmcmFtZXMgY2FuIG9ubHkgYmUgY29waWVkLCBub3QgXCJibGVuZGVkXCJcbiAgICAgICAgdmFyIGZybXMgPSBVUE5HLmVuY29kZS5mcmFtaXplKGJ1ZnMsIHcsIGgsIGZvckdJRiwgYnJ1dGUpO1xuICAgICAgICAvL2NvbnNvbGUubG9nKFwiZnJhbWl6ZVwiLCBEYXRlLm5vdygpLXRpbWUpOyAgdGltZSA9IERhdGUubm93KCk7XG4gICAgICAgIHZhciBjbWFwID0ge30sXG4gICAgICAgICAgICBwbHRlID0gW10sXG4gICAgICAgICAgICBpbmRzID0gW107XG5cbiAgICAgICAgaWYgKHBzICE9IDApIHtcbiAgICAgICAgICAgIHZhciBuYnVmcyA9IFtdO1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBmcm1zLmxlbmd0aDsgaSsrKSBuYnVmcy5wdXNoKGZybXNbaV0uaW1nLmJ1ZmZlcik7XG5cbiAgICAgICAgICAgIHZhciBhYnVmID0gVVBORy5lbmNvZGUuY29uY2F0UkdCQShuYnVmcywgZm9yR0lGKSxcbiAgICAgICAgICAgICAgICBxcmVzID0gVVBORy5xdWFudGl6ZShhYnVmLCBwcyk7XG4gICAgICAgICAgICB2YXIgY29mID0gMCxcbiAgICAgICAgICAgICAgICBiYiA9IG5ldyBVaW50OEFycmF5KHFyZXMuYWJ1Zik7XG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGZybXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICB2YXIgdGkgPSBmcm1zW2ldLmltZyxcbiAgICAgICAgICAgICAgICAgICAgYmxuID0gdGkubGVuZ3RoO1xuICAgICAgICAgICAgICAgIGluZHMucHVzaChuZXcgVWludDhBcnJheShxcmVzLmluZHMuYnVmZmVyLCBjb2YgPj4gMiwgYmxuID4+IDIpKTtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGJsbjsgaiArPSA0KSB7XG4gICAgICAgICAgICAgICAgICAgIHRpW2pdID0gYmJbY29mICsgal07XG4gICAgICAgICAgICAgICAgICAgIHRpW2ogKyAxXSA9IGJiW2NvZiArIGogKyAxXTtcbiAgICAgICAgICAgICAgICAgICAgdGlbaiArIDJdID0gYmJbY29mICsgaiArIDJdO1xuICAgICAgICAgICAgICAgICAgICB0aVtqICsgM10gPSBiYltjb2YgKyBqICsgM107XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNvZiArPSBibG47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcXJlcy5wbHRlLmxlbmd0aDsgaSsrKSBwbHRlLnB1c2gocXJlcy5wbHRlW2ldLmVzdC5yZ2JhKTtcbiAgICAgICAgICAgIC8vY29uc29sZS5sb2coXCJxdWFudGl6ZVwiLCBEYXRlLm5vdygpLXRpbWUpOyAgdGltZSA9IERhdGUubm93KCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyB3aGF0IGlmIHBzPT0wLCBidXQgdGhlcmUgYXJlIDw9MjU2IGNvbG9ycz8gIHdlIHN0aWxsIG5lZWQgdG8gZGV0ZWN0LCBpZiB0aGUgcGFsZXR0ZSBjb3VsZCBiZSB1c2VkXG4gICAgICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGZybXMubGVuZ3RoOyBqKyspIHsgLy8gd2hlbiBub3QgcXVhbnRpemVkLCBvdGhlciBmcmFtZXMgY2FuIGNvbnRhaW4gY29sb3JzLCB0aGF0IGFyZSBub3QgaW4gYW4gaW5pdGlhbCBmcmFtZVxuICAgICAgICAgICAgICAgIHZhciBmcm0gPSBmcm1zW2pdLFxuICAgICAgICAgICAgICAgICAgICBpbWczMiA9IG5ldyBVaW50MzJBcnJheShmcm0uaW1nLmJ1ZmZlciksXG4gICAgICAgICAgICAgICAgICAgIG53ID0gZnJtLnJlY3Qud2lkdGgsXG4gICAgICAgICAgICAgICAgICAgIGlsZW4gPSBpbWczMi5sZW5ndGg7XG4gICAgICAgICAgICAgICAgdmFyIGluZCA9IG5ldyBVaW50OEFycmF5KGlsZW4pO1xuICAgICAgICAgICAgICAgIGluZHMucHVzaChpbmQpO1xuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgaWxlbjsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBjID0gaW1nMzJbaV07XG4gICAgICAgICAgICAgICAgICAgIGlmIChpICE9IDAgJiYgYyA9PSBpbWczMltpIC0gMV0pIGluZFtpXSA9IGluZFtpIC0gMV07XG4gICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKGkgPiBudyAmJiBjID09IGltZzMyW2kgLSBud10pIGluZFtpXSA9IGluZFtpIC0gbnddO1xuICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBjbWMgPSBjbWFwW2NdO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGNtYyA9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY21hcFtjXSA9IGNtYyA9IHBsdGUubGVuZ3RoO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBsdGUucHVzaChjKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAocGx0ZS5sZW5ndGggPj0gMzAwKSBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGluZFtpXSA9IGNtYztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vY29uc29sZS5sb2coXCJtYWtlIHBhbGV0dGVcIiwgRGF0ZS5ub3coKS10aW1lKTsgIHRpbWUgPSBEYXRlLm5vdygpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGNjID0gcGx0ZS5sZW5ndGg7IC8vY29uc29sZS5sb2coXCJjb2xvcnM6XCIsY2MpO1xuICAgICAgICBpZiAoY2MgPD0gMjU2ICYmIGZvcmJpZFBsdGUgPT0gZmFsc2UpIHtcbiAgICAgICAgICAgIGlmIChjYyA8PSAyKSBkZXB0aCA9IDE7XG4gICAgICAgICAgICBlbHNlIGlmIChjYyA8PSA0KSBkZXB0aCA9IDI7XG4gICAgICAgICAgICBlbHNlIGlmIChjYyA8PSAxNikgZGVwdGggPSA0O1xuICAgICAgICAgICAgZWxzZSBkZXB0aCA9IDg7XG4gICAgICAgICAgICBpZiAoZm9yR0lGKSBkZXB0aCA9IDg7XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGZybXMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICAgIHZhciBmcm0gPSBmcm1zW2pdLFxuICAgICAgICAgICAgICAgIG54ID0gZnJtLnJlY3QueCxcbiAgICAgICAgICAgICAgICBueSA9IGZybS5yZWN0LnksXG4gICAgICAgICAgICAgICAgbncgPSBmcm0ucmVjdC53aWR0aCxcbiAgICAgICAgICAgICAgICBuaCA9IGZybS5yZWN0LmhlaWdodDtcbiAgICAgICAgICAgIHZhciBjaW1nID0gZnJtLmltZyxcbiAgICAgICAgICAgICAgICBjaW1nMzIgPSBuZXcgVWludDMyQXJyYXkoY2ltZy5idWZmZXIpO1xuICAgICAgICAgICAgdmFyIGJwbCA9IDQgKiBudyxcbiAgICAgICAgICAgICAgICBicHAgPSA0O1xuICAgICAgICAgICAgaWYgKGNjIDw9IDI1NiAmJiBmb3JiaWRQbHRlID09IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgYnBsID0gTWF0aC5jZWlsKGRlcHRoICogbncgLyA4KTtcbiAgICAgICAgICAgICAgICB2YXIgbmltZyA9IG5ldyBVaW50OEFycmF5KGJwbCAqIG5oKTtcbiAgICAgICAgICAgICAgICB2YXIgaW5qID0gaW5kc1tqXTtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciB5ID0gMDsgeSA8IG5oOyB5KyspIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGkgPSB5ICogYnBsLFxuICAgICAgICAgICAgICAgICAgICAgICAgaWkgPSB5ICogbnc7XG4gICAgICAgICAgICAgICAgICAgIGlmIChkZXB0aCA9PSA4KVxuICAgICAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIgeCA9IDA7IHggPCBudzsgeCsrKSBuaW1nW2kgKyAoeCldID0gKGlualtpaSArIHhdKTtcbiAgICAgICAgICAgICAgICAgICAgZWxzZSBpZiAoZGVwdGggPT0gNClcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAodmFyIHggPSAwOyB4IDwgbnc7IHgrKykgbmltZ1tpICsgKHggPj4gMSldIHw9IChpbmpbaWkgKyB4XSA8PCAoNCAtICh4ICYgMSkgKiA0KSk7XG4gICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKGRlcHRoID09IDIpXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciB4ID0gMDsgeCA8IG53OyB4KyspIG5pbWdbaSArICh4ID4+IDIpXSB8PSAoaW5qW2lpICsgeF0gPDwgKDYgLSAoeCAmIDMpICogMikpO1xuICAgICAgICAgICAgICAgICAgICBlbHNlIGlmIChkZXB0aCA9PSAxKVxuICAgICAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIgeCA9IDA7IHggPCBudzsgeCsrKSBuaW1nW2kgKyAoeCA+PiAzKV0gfD0gKGlualtpaSArIHhdIDw8ICg3IC0gKHggJiA3KSAqIDEpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY2ltZyA9IG5pbWc7XG4gICAgICAgICAgICAgICAgY3R5cGUgPSAzO1xuICAgICAgICAgICAgICAgIGJwcCA9IDE7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGdvdEFscGhhID09IGZhbHNlICYmIGZybXMubGVuZ3RoID09IDEpIHsgLy8gc29tZSBuZXh0IFwicmVkdWNlZFwiIGZyYW1lcyBtYXkgY29udGFpbiBhbHBoYSBmb3IgYmxlbmRpbmdcbiAgICAgICAgICAgICAgICB2YXIgbmltZyA9IG5ldyBVaW50OEFycmF5KG53ICogbmggKiAzKSxcbiAgICAgICAgICAgICAgICAgICAgYXJlYSA9IG53ICogbmg7XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcmVhOyBpKyspIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHRpID0gaSAqIDMsXG4gICAgICAgICAgICAgICAgICAgICAgICBxaSA9IGkgKiA0O1xuICAgICAgICAgICAgICAgICAgICBuaW1nW3RpXSA9IGNpbWdbcWldO1xuICAgICAgICAgICAgICAgICAgICBuaW1nW3RpICsgMV0gPSBjaW1nW3FpICsgMV07XG4gICAgICAgICAgICAgICAgICAgIG5pbWdbdGkgKyAyXSA9IGNpbWdbcWkgKyAyXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY2ltZyA9IG5pbWc7XG4gICAgICAgICAgICAgICAgY3R5cGUgPSAyO1xuICAgICAgICAgICAgICAgIGJwcCA9IDM7XG4gICAgICAgICAgICAgICAgYnBsID0gMyAqIG53O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZnJtLmltZyA9IGNpbWc7XG4gICAgICAgICAgICBmcm0uYnBsID0gYnBsO1xuICAgICAgICAgICAgZnJtLmJwcCA9IGJwcDtcbiAgICAgICAgfVxuICAgICAgICAvL2NvbnNvbGUubG9nKFwiY29sb3JzID0+IHBhbGV0dGUgaW5kaWNlc1wiLCBEYXRlLm5vdygpLXRpbWUpOyAgdGltZSA9IERhdGUubm93KCk7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBjdHlwZTogY3R5cGUsXG4gICAgICAgICAgICBkZXB0aDogZGVwdGgsXG4gICAgICAgICAgICBwbHRlOiBwbHRlLFxuICAgICAgICAgICAgZnJhbWVzOiBmcm1zXG4gICAgICAgIH07XG4gICAgfVxuICAgIFVQTkcuZW5jb2RlLmZyYW1pemUgPSBmdW5jdGlvbiAoYnVmcywgdywgaCwgZm9yR0lGLCBicnV0ZSkge1xuICAgICAgICB2YXIgZnJtcyA9IFtdO1xuICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGJ1ZnMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICAgIHZhciBjaW1nID0gbmV3IFVpbnQ4QXJyYXkoYnVmc1tqXSksXG4gICAgICAgICAgICAgICAgY2ltZzMyID0gbmV3IFVpbnQzMkFycmF5KGNpbWcuYnVmZmVyKTtcblxuICAgICAgICAgICAgdmFyIG54ID0gMCxcbiAgICAgICAgICAgICAgICBueSA9IDAsXG4gICAgICAgICAgICAgICAgbncgPSB3LFxuICAgICAgICAgICAgICAgIG5oID0gaCxcbiAgICAgICAgICAgICAgICBibGVuZCA9IDA7XG4gICAgICAgICAgICBpZiAoaiAhPSAwICYmICFicnV0ZSkge1xuICAgICAgICAgICAgICAgIHZhciB0bGltID0gKGZvckdJRiB8fCBqID09IDEgfHwgZnJtc1tmcm1zLmxlbmd0aCAtIDJdLmRpc3Bvc2UgPT0gMikgPyAxIDogMixcbiAgICAgICAgICAgICAgICAgICAgdHN0cCA9IDAsXG4gICAgICAgICAgICAgICAgICAgIHRhcmVhID0gMWU5O1xuICAgICAgICAgICAgICAgIGZvciAodmFyIGl0ID0gMDsgaXQgPCB0bGltOyBpdCsrKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBwaW1nID0gbmV3IFVpbnQ4QXJyYXkoYnVmc1tqIC0gMSAtIGl0XSksXG4gICAgICAgICAgICAgICAgICAgICAgICBwMzIgPSBuZXcgVWludDMyQXJyYXkoYnVmc1tqIC0gMSAtIGl0XSk7XG4gICAgICAgICAgICAgICAgICAgIHZhciBtaXggPSB3LFxuICAgICAgICAgICAgICAgICAgICAgICAgbWl5ID0gaCxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1heCA9IC0xLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWF5ID0gLTE7XG4gICAgICAgICAgICAgICAgICAgIGZvciAodmFyIHkgPSAwOyB5IDwgaDsgeSsrKVxuICAgICAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIgeCA9IDA7IHggPCB3OyB4KyspIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YXIgaSA9IHkgKiB3ICsgeDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoY2ltZzMyW2ldICE9IHAzMltpXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoeCA8IG1peCkgbWl4ID0geDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHggPiBtYXgpIG1heCA9IHg7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh5IDwgbWl5KSBtaXkgPSB5O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoeSA+IG1heSkgbWF5ID0geTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHZhciBzYXJlYSA9IChtYXggPT0gLTEpID8gMSA6IChtYXggLSBtaXggKyAxKSAqIChtYXkgLSBtaXkgKyAxKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHNhcmVhIDwgdGFyZWEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmVhID0gc2FyZWE7XG4gICAgICAgICAgICAgICAgICAgICAgICB0c3RwID0gaXQ7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAobWF4ID09IC0xKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbnggPSBueSA9IDA7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbncgPSBuaCA9IDE7XG4gICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG54ID0gbWl4O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG55ID0gbWl5O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG53ID0gbWF4IC0gbWl4ICsgMTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBuaCA9IG1heSAtIG1peSArIDE7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB2YXIgcGltZyA9IG5ldyBVaW50OEFycmF5KGJ1ZnNbaiAtIDEgLSB0c3RwXSk7XG4gICAgICAgICAgICAgICAgaWYgKHRzdHAgPT0gMSkgZnJtc1tmcm1zLmxlbmd0aCAtIDFdLmRpc3Bvc2UgPSAyO1xuXG4gICAgICAgICAgICAgICAgdmFyIG5pbWcgPSBuZXcgVWludDhBcnJheShudyAqIG5oICogNCksXG4gICAgICAgICAgICAgICAgICAgIG5pbWczMiA9IG5ldyBVaW50MzJBcnJheShuaW1nLmJ1ZmZlcik7XG4gICAgICAgICAgICAgICAgVVBORy5fY29weVRpbGUocGltZywgdywgaCwgbmltZywgbncsIG5oLCAtbngsIC1ueSwgMCk7XG4gICAgICAgICAgICAgICAgaWYgKFVQTkcuX2NvcHlUaWxlKGNpbWcsIHcsIGgsIG5pbWcsIG53LCBuaCwgLW54LCAtbnksIDMpKSB7XG4gICAgICAgICAgICAgICAgICAgIFVQTkcuX2NvcHlUaWxlKGNpbWcsIHcsIGgsIG5pbWcsIG53LCBuaCwgLW54LCAtbnksIDIpO1xuICAgICAgICAgICAgICAgICAgICBibGVuZCA9IDE7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgVVBORy5fY29weVRpbGUoY2ltZywgdywgaCwgbmltZywgbncsIG5oLCAtbngsIC1ueSwgMCk7XG4gICAgICAgICAgICAgICAgICAgIGJsZW5kID0gMDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY2ltZyA9IG5pbWc7XG4gICAgICAgICAgICB9IGVsc2UgY2ltZyA9IGNpbWcuc2xpY2UoMCk7IC8vIGltZyBtYXkgYmUgcmV3cml0ZWQgZnVydGhlciAuLi4gZG9uJ3QgcmV3cml0ZSBpbnB1dFxuICAgICAgICAgICAgZnJtcy5wdXNoKHtcbiAgICAgICAgICAgICAgICByZWN0OiB7XG4gICAgICAgICAgICAgICAgICAgIHg6IG54LFxuICAgICAgICAgICAgICAgICAgICB5OiBueSxcbiAgICAgICAgICAgICAgICAgICAgd2lkdGg6IG53LFxuICAgICAgICAgICAgICAgICAgICBoZWlnaHQ6IG5oXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBpbWc6IGNpbWcsXG4gICAgICAgICAgICAgICAgYmxlbmQ6IGJsZW5kLFxuICAgICAgICAgICAgICAgIGRpc3Bvc2U6IGJydXRlID8gMSA6IDBcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmcm1zO1xuICAgIH1cblxuICAgIFVQTkcuZW5jb2RlLl9maWx0ZXJaZXJvID0gZnVuY3Rpb24gKGltZywgaCwgYnBwLCBicGwsIGRhdGEsIGZpbHRlcikge1xuICAgICAgICBpZiAoZmlsdGVyICE9IC0xKSB7XG4gICAgICAgICAgICBmb3IgKHZhciB5ID0gMDsgeSA8IGg7IHkrKykgVVBORy5lbmNvZGUuX2ZpbHRlckxpbmUoZGF0YSwgaW1nLCB5LCBicGwsIGJwcCwgZmlsdGVyKTtcbiAgICAgICAgICAgIHJldHVybiBwYWtvW1wiZGVmbGF0ZVwiXShkYXRhKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgZmxzID0gW107XG4gICAgICAgIGZvciAodmFyIHQgPSAwOyB0IDwgNTsgdCsrKSB7XG4gICAgICAgICAgICBpZiAoaCAqIGJwbCA+IDUwMDAwMCAmJiAodCA9PSAyIHx8IHQgPT0gMyB8fCB0ID09IDQpKSBjb250aW51ZTtcbiAgICAgICAgICAgIGZvciAodmFyIHkgPSAwOyB5IDwgaDsgeSsrKSBVUE5HLmVuY29kZS5fZmlsdGVyTGluZShkYXRhLCBpbWcsIHksIGJwbCwgYnBwLCB0KTtcbiAgICAgICAgICAgIGZscy5wdXNoKHBha29bXCJkZWZsYXRlXCJdKGRhdGEpKTtcbiAgICAgICAgICAgIGlmIChicHAgPT0gMSkgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHRpLCB0c2l6ZSA9IDFlOTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBmbHMubGVuZ3RoOyBpKyspXG4gICAgICAgICAgICBpZiAoZmxzW2ldLmxlbmd0aCA8IHRzaXplKSB7XG4gICAgICAgICAgICAgICAgdGkgPSBpO1xuICAgICAgICAgICAgICAgIHRzaXplID0gZmxzW2ldLmxlbmd0aDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZsc1t0aV07XG4gICAgfVxuICAgIFVQTkcuZW5jb2RlLl9maWx0ZXJMaW5lID0gZnVuY3Rpb24gKGRhdGEsIGltZywgeSwgYnBsLCBicHAsIHR5cGUpIHtcbiAgICAgICAgdmFyIGkgPSB5ICogYnBsLFxuICAgICAgICAgICAgZGkgPSBpICsgeSxcbiAgICAgICAgICAgIHBhZXRoID0gVVBORy5kZWNvZGUuX3BhZXRoO1xuICAgICAgICBkYXRhW2RpXSA9IHR5cGU7XG4gICAgICAgIGRpKys7XG5cbiAgICAgICAgaWYgKHR5cGUgPT0gMClcbiAgICAgICAgICAgIGZvciAodmFyIHggPSAwOyB4IDwgYnBsOyB4KyspIGRhdGFbZGkgKyB4XSA9IGltZ1tpICsgeF07XG4gICAgICAgIGVsc2UgaWYgKHR5cGUgPT0gMSkge1xuICAgICAgICAgICAgZm9yICh2YXIgeCA9IDA7IHggPCBicHA7IHgrKykgZGF0YVtkaSArIHhdID0gaW1nW2kgKyB4XTtcbiAgICAgICAgICAgIGZvciAodmFyIHggPSBicHA7IHggPCBicGw7IHgrKykgZGF0YVtkaSArIHhdID0gKGltZ1tpICsgeF0gLSBpbWdbaSArIHggLSBicHBdICsgMjU2KSAmIDI1NTtcbiAgICAgICAgfSBlbHNlIGlmICh5ID09IDApIHtcbiAgICAgICAgICAgIGZvciAodmFyIHggPSAwOyB4IDwgYnBwOyB4KyspIGRhdGFbZGkgKyB4XSA9IGltZ1tpICsgeF07XG5cbiAgICAgICAgICAgIGlmICh0eXBlID09IDIpXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgeCA9IGJwcDsgeCA8IGJwbDsgeCsrKSBkYXRhW2RpICsgeF0gPSBpbWdbaSArIHhdO1xuICAgICAgICAgICAgaWYgKHR5cGUgPT0gMylcbiAgICAgICAgICAgICAgICBmb3IgKHZhciB4ID0gYnBwOyB4IDwgYnBsOyB4KyspIGRhdGFbZGkgKyB4XSA9IChpbWdbaSArIHhdIC0gKGltZ1tpICsgeCAtIGJwcF0gPj4gMSkgKyAyNTYpICYgMjU1O1xuICAgICAgICAgICAgaWYgKHR5cGUgPT0gNClcbiAgICAgICAgICAgICAgICBmb3IgKHZhciB4ID0gYnBwOyB4IDwgYnBsOyB4KyspIGRhdGFbZGkgKyB4XSA9IChpbWdbaSArIHhdIC0gcGFldGgoaW1nW2kgKyB4IC0gYnBwXSwgMCwgMCkgKyAyNTYpICYgMjU1O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaWYgKHR5cGUgPT0gMikge1xuICAgICAgICAgICAgICAgIGZvciAodmFyIHggPSAwOyB4IDwgYnBsOyB4KyspIGRhdGFbZGkgKyB4XSA9IChpbWdbaSArIHhdICsgMjU2IC0gaW1nW2kgKyB4IC0gYnBsXSkgJiAyNTU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodHlwZSA9PSAzKSB7XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgeCA9IDA7IHggPCBicHA7IHgrKykgZGF0YVtkaSArIHhdID0gKGltZ1tpICsgeF0gKyAyNTYgLSAoaW1nW2kgKyB4IC0gYnBsXSA+PiAxKSkgJiAyNTU7XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgeCA9IGJwcDsgeCA8IGJwbDsgeCsrKSBkYXRhW2RpICsgeF0gPSAoaW1nW2kgKyB4XSArIDI1NiAtICgoaW1nW2kgKyB4IC0gYnBsXSArIGltZ1tpICsgeCAtIGJwcF0pID4+IDEpKSAmIDI1NTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh0eXBlID09IDQpIHtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciB4ID0gMDsgeCA8IGJwcDsgeCsrKSBkYXRhW2RpICsgeF0gPSAoaW1nW2kgKyB4XSArIDI1NiAtIHBhZXRoKDAsIGltZ1tpICsgeCAtIGJwbF0sIDApKSAmIDI1NTtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciB4ID0gYnBwOyB4IDwgYnBsOyB4KyspIGRhdGFbZGkgKyB4XSA9IChpbWdbaSArIHhdICsgMjU2IC0gcGFldGgoaW1nW2kgKyB4IC0gYnBwXSwgaW1nW2kgKyB4IC0gYnBsXSwgaW1nW2kgKyB4IC0gYnBwIC0gYnBsXSkpICYgMjU1O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgVVBORy5jcmMgPSB7XG4gICAgICAgIHRhYmxlOiAoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHRhYiA9IG5ldyBVaW50MzJBcnJheSgyNTYpO1xuICAgICAgICAgICAgZm9yICh2YXIgbiA9IDA7IG4gPCAyNTY7IG4rKykge1xuICAgICAgICAgICAgICAgIHZhciBjID0gbjtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBrID0gMDsgayA8IDg7IGsrKykge1xuICAgICAgICAgICAgICAgICAgICBpZiAoYyAmIDEpIGMgPSAweGVkYjg4MzIwIF4gKGMgPj4+IDEpO1xuICAgICAgICAgICAgICAgICAgICBlbHNlIGMgPSBjID4+PiAxO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0YWJbbl0gPSBjO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRhYjtcbiAgICAgICAgfSkoKSxcbiAgICAgICAgdXBkYXRlOiBmdW5jdGlvbiAoYywgYnVmLCBvZmYsIGxlbikge1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykgYyA9IFVQTkcuY3JjLnRhYmxlWyhjIF4gYnVmW29mZiArIGldKSAmIDB4ZmZdIF4gKGMgPj4+IDgpO1xuICAgICAgICAgICAgcmV0dXJuIGM7XG4gICAgICAgIH0sXG4gICAgICAgIGNyYzogZnVuY3Rpb24gKGIsIG8sIGwpIHtcbiAgICAgICAgICAgIHJldHVybiBVUE5HLmNyYy51cGRhdGUoMHhmZmZmZmZmZiwgYiwgbywgbCkgXiAweGZmZmZmZmZmO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgVVBORy5xdWFudGl6ZSA9IGZ1bmN0aW9uIChhYnVmLCBwcykge1xuICAgICAgICB2YXIgb2ltZyA9IG5ldyBVaW50OEFycmF5KGFidWYpLFxuICAgICAgICAgICAgbmltZyA9IG9pbWcuc2xpY2UoMCksXG4gICAgICAgICAgICBuaW1nMzIgPSBuZXcgVWludDMyQXJyYXkobmltZy5idWZmZXIpO1xuXG4gICAgICAgIHZhciBLRCA9IFVQTkcucXVhbnRpemUuZ2V0S0R0cmVlKG5pbWcsIHBzKTtcbiAgICAgICAgdmFyIHJvb3QgPSBLRFswXSxcbiAgICAgICAgICAgIGxlYWZzID0gS0RbMV07XG5cbiAgICAgICAgdmFyIHBsYW5lRHN0ID0gVVBORy5xdWFudGl6ZS5wbGFuZURzdDtcbiAgICAgICAgdmFyIHNiID0gb2ltZyxcbiAgICAgICAgICAgIHRiID0gbmltZzMyLFxuICAgICAgICAgICAgbGVuID0gc2IubGVuZ3RoO1xuXG4gICAgICAgIHZhciBpbmRzID0gbmV3IFVpbnQ4QXJyYXkob2ltZy5sZW5ndGggPj4gMik7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpICs9IDQpIHtcbiAgICAgICAgICAgIHZhciByID0gc2JbaV0gKiAoMSAvIDI1NSksXG4gICAgICAgICAgICAgICAgZyA9IHNiW2kgKyAxXSAqICgxIC8gMjU1KSxcbiAgICAgICAgICAgICAgICBiID0gc2JbaSArIDJdICogKDEgLyAyNTUpLFxuICAgICAgICAgICAgICAgIGEgPSBzYltpICsgM10gKiAoMSAvIDI1NSk7XG5cbiAgICAgICAgICAgIC8vICBleGFjdCwgYnV0IHRvbyBzbG93IDooXG4gICAgICAgICAgICB2YXIgbmQgPSBVUE5HLnF1YW50aXplLmdldE5lYXJlc3Qocm9vdCwgciwgZywgYiwgYSk7XG4gICAgICAgICAgICAvL3ZhciBuZCA9IHJvb3Q7XG4gICAgICAgICAgICAvL3doaWxlKG5kLmxlZnQpIG5kID0gKHBsYW5lRHN0KG5kLmVzdCxyLGcsYixhKTw9MCkgPyBuZC5sZWZ0IDogbmQucmlnaHQ7XG4gICAgICAgICAgICBpbmRzW2kgPj4gMl0gPSBuZC5pbmQ7XG4gICAgICAgICAgICB0YltpID4+IDJdID0gbmQuZXN0LnJnYmE7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGFidWY6IG5pbWcuYnVmZmVyLFxuICAgICAgICAgICAgaW5kczogaW5kcyxcbiAgICAgICAgICAgIHBsdGU6IGxlYWZzXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgVVBORy5xdWFudGl6ZS5nZXRLRHRyZWUgPSBmdW5jdGlvbiAobmltZywgcHMsIGVycikge1xuICAgICAgICBpZiAoZXJyID09IG51bGwpIGVyciA9IDAuMDAwMTtcbiAgICAgICAgdmFyIG5pbWczMiA9IG5ldyBVaW50MzJBcnJheShuaW1nLmJ1ZmZlcik7XG5cbiAgICAgICAgdmFyIHJvb3QgPSB7XG4gICAgICAgICAgICBpMDogMCxcbiAgICAgICAgICAgIGkxOiBuaW1nLmxlbmd0aCxcbiAgICAgICAgICAgIGJzdDogbnVsbCxcbiAgICAgICAgICAgIGVzdDogbnVsbCxcbiAgICAgICAgICAgIHRkc3Q6IDAsXG4gICAgICAgICAgICBsZWZ0OiBudWxsLFxuICAgICAgICAgICAgcmlnaHQ6IG51bGxcbiAgICAgICAgfTsgLy8gYmFzaWMgc3RhdGlzdGljLCBleHRyYSBzdGF0aXN0aWNcbiAgICAgICAgcm9vdC5ic3QgPSBVUE5HLnF1YW50aXplLnN0YXRzKG5pbWcsIHJvb3QuaTAsIHJvb3QuaTEpO1xuICAgICAgICByb290LmVzdCA9IFVQTkcucXVhbnRpemUuZXN0YXRzKHJvb3QuYnN0KTtcbiAgICAgICAgdmFyIGxlYWZzID0gW3Jvb3RdO1xuXG4gICAgICAgIHdoaWxlIChsZWFmcy5sZW5ndGggPCBwcykge1xuICAgICAgICAgICAgdmFyIG1heEwgPSAwLFxuICAgICAgICAgICAgICAgIG1pID0gMDtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVhZnMubGVuZ3RoOyBpKyspXG4gICAgICAgICAgICAgICAgaWYgKGxlYWZzW2ldLmVzdC5MID4gbWF4TCkge1xuICAgICAgICAgICAgICAgICAgICBtYXhMID0gbGVhZnNbaV0uZXN0Lkw7XG4gICAgICAgICAgICAgICAgICAgIG1pID0gaTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAobWF4TCA8IGVycikgYnJlYWs7XG4gICAgICAgICAgICB2YXIgbm9kZSA9IGxlYWZzW21pXTtcblxuICAgICAgICAgICAgdmFyIHMwID0gVVBORy5xdWFudGl6ZS5zcGxpdFBpeGVscyhuaW1nLCBuaW1nMzIsIG5vZGUuaTAsIG5vZGUuaTEsIG5vZGUuZXN0LmUsIG5vZGUuZXN0LmVNcTI1NSk7XG4gICAgICAgICAgICB2YXIgczB3cm9uZyA9IChub2RlLmkwID49IHMwIHx8IG5vZGUuaTEgPD0gczApO1xuICAgICAgICAgICAgLy9jb25zb2xlLmxvZyhtYXhMLCBsZWFmcy5sZW5ndGgsIG1pKTtcbiAgICAgICAgICAgIGlmIChzMHdyb25nKSB7XG4gICAgICAgICAgICAgICAgbm9kZS5lc3QuTCA9IDA7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBsbiA9IHtcbiAgICAgICAgICAgICAgICBpMDogbm9kZS5pMCxcbiAgICAgICAgICAgICAgICBpMTogczAsXG4gICAgICAgICAgICAgICAgYnN0OiBudWxsLFxuICAgICAgICAgICAgICAgIGVzdDogbnVsbCxcbiAgICAgICAgICAgICAgICB0ZHN0OiAwLFxuICAgICAgICAgICAgICAgIGxlZnQ6IG51bGwsXG4gICAgICAgICAgICAgICAgcmlnaHQ6IG51bGxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBsbi5ic3QgPSBVUE5HLnF1YW50aXplLnN0YXRzKG5pbWcsIGxuLmkwLCBsbi5pMSk7XG4gICAgICAgICAgICBsbi5lc3QgPSBVUE5HLnF1YW50aXplLmVzdGF0cyhsbi5ic3QpO1xuICAgICAgICAgICAgdmFyIHJuID0ge1xuICAgICAgICAgICAgICAgIGkwOiBzMCxcbiAgICAgICAgICAgICAgICBpMTogbm9kZS5pMSxcbiAgICAgICAgICAgICAgICBic3Q6IG51bGwsXG4gICAgICAgICAgICAgICAgZXN0OiBudWxsLFxuICAgICAgICAgICAgICAgIHRkc3Q6IDAsXG4gICAgICAgICAgICAgICAgbGVmdDogbnVsbCxcbiAgICAgICAgICAgICAgICByaWdodDogbnVsbFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHJuLmJzdCA9IHtcbiAgICAgICAgICAgICAgICBSOiBbXSxcbiAgICAgICAgICAgICAgICBtOiBbXSxcbiAgICAgICAgICAgICAgICBOOiBub2RlLmJzdC5OIC0gbG4uYnN0Lk5cbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IDE2OyBpKyspIHJuLmJzdC5SW2ldID0gbm9kZS5ic3QuUltpXSAtIGxuLmJzdC5SW2ldO1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCA0OyBpKyspIHJuLmJzdC5tW2ldID0gbm9kZS5ic3QubVtpXSAtIGxuLmJzdC5tW2ldO1xuICAgICAgICAgICAgcm4uZXN0ID0gVVBORy5xdWFudGl6ZS5lc3RhdHMocm4uYnN0KTtcblxuICAgICAgICAgICAgbm9kZS5sZWZ0ID0gbG47XG4gICAgICAgICAgICBub2RlLnJpZ2h0ID0gcm47XG4gICAgICAgICAgICBsZWFmc1ttaV0gPSBsbjtcbiAgICAgICAgICAgIGxlYWZzLnB1c2gocm4pO1xuICAgICAgICB9XG4gICAgICAgIGxlYWZzLnNvcnQoZnVuY3Rpb24gKGEsIGIpIHtcbiAgICAgICAgICAgIHJldHVybiBiLmJzdC5OIC0gYS5ic3QuTjtcbiAgICAgICAgfSk7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVhZnMubGVuZ3RoOyBpKyspIGxlYWZzW2ldLmluZCA9IGk7XG4gICAgICAgIHJldHVybiBbcm9vdCwgbGVhZnNdO1xuICAgIH1cblxuICAgIFVQTkcucXVhbnRpemUuZ2V0TmVhcmVzdCA9IGZ1bmN0aW9uIChuZCwgciwgZywgYiwgYSkge1xuICAgICAgICBpZiAobmQubGVmdCA9PSBudWxsKSB7XG4gICAgICAgICAgICBuZC50ZHN0ID0gVVBORy5xdWFudGl6ZS5kaXN0KG5kLmVzdC5xLCByLCBnLCBiLCBhKTtcbiAgICAgICAgICAgIHJldHVybiBuZDtcbiAgICAgICAgfVxuICAgICAgICB2YXIgcGxhbmVEc3QgPSBVUE5HLnF1YW50aXplLnBsYW5lRHN0KG5kLmVzdCwgciwgZywgYiwgYSk7XG5cbiAgICAgICAgdmFyIG5vZGUwID0gbmQubGVmdCxcbiAgICAgICAgICAgIG5vZGUxID0gbmQucmlnaHQ7XG4gICAgICAgIGlmIChwbGFuZURzdCA+IDApIHtcbiAgICAgICAgICAgIG5vZGUwID0gbmQucmlnaHQ7XG4gICAgICAgICAgICBub2RlMSA9IG5kLmxlZnQ7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgbG4gPSBVUE5HLnF1YW50aXplLmdldE5lYXJlc3Qobm9kZTAsIHIsIGcsIGIsIGEpO1xuICAgICAgICBpZiAobG4udGRzdCA8PSBwbGFuZURzdCAqIHBsYW5lRHN0KSByZXR1cm4gbG47XG4gICAgICAgIHZhciBybiA9IFVQTkcucXVhbnRpemUuZ2V0TmVhcmVzdChub2RlMSwgciwgZywgYiwgYSk7XG4gICAgICAgIHJldHVybiBybi50ZHN0IDwgbG4udGRzdCA/IHJuIDogbG47XG4gICAgfVxuICAgIFVQTkcucXVhbnRpemUucGxhbmVEc3QgPSBmdW5jdGlvbiAoZXN0LCByLCBnLCBiLCBhKSB7XG4gICAgICAgIHZhciBlID0gZXN0LmU7XG4gICAgICAgIHJldHVybiBlWzBdICogciArIGVbMV0gKiBnICsgZVsyXSAqIGIgKyBlWzNdICogYSAtIGVzdC5lTXE7XG4gICAgfVxuICAgIFVQTkcucXVhbnRpemUuZGlzdCA9IGZ1bmN0aW9uIChxLCByLCBnLCBiLCBhKSB7XG4gICAgICAgIHZhciBkMCA9IHIgLSBxWzBdLFxuICAgICAgICAgICAgZDEgPSBnIC0gcVsxXSxcbiAgICAgICAgICAgIGQyID0gYiAtIHFbMl0sXG4gICAgICAgICAgICBkMyA9IGEgLSBxWzNdO1xuICAgICAgICByZXR1cm4gZDAgKiBkMCArIGQxICogZDEgKyBkMiAqIGQyICsgZDMgKiBkMztcbiAgICB9XG5cbiAgICBVUE5HLnF1YW50aXplLnNwbGl0UGl4ZWxzID0gZnVuY3Rpb24gKG5pbWcsIG5pbWczMiwgaTAsIGkxLCBlLCBlTXEpIHtcbiAgICAgICAgdmFyIHZlY0RvdCA9IFVQTkcucXVhbnRpemUudmVjRG90O1xuICAgICAgICBpMSAtPSA0O1xuICAgICAgICB2YXIgc2hmcyA9IDA7XG4gICAgICAgIHdoaWxlIChpMCA8IGkxKSB7XG4gICAgICAgICAgICB3aGlsZSAodmVjRG90KG5pbWcsIGkwLCBlKSA8PSBlTXEpIGkwICs9IDQ7XG4gICAgICAgICAgICB3aGlsZSAodmVjRG90KG5pbWcsIGkxLCBlKSA+IGVNcSkgaTEgLT0gNDtcbiAgICAgICAgICAgIGlmIChpMCA+PSBpMSkgYnJlYWs7XG5cbiAgICAgICAgICAgIHZhciB0ID0gbmltZzMyW2kwID4+IDJdO1xuICAgICAgICAgICAgbmltZzMyW2kwID4+IDJdID0gbmltZzMyW2kxID4+IDJdO1xuICAgICAgICAgICAgbmltZzMyW2kxID4+IDJdID0gdDtcblxuICAgICAgICAgICAgaTAgKz0gNDtcbiAgICAgICAgICAgIGkxIC09IDQ7XG4gICAgICAgIH1cbiAgICAgICAgd2hpbGUgKHZlY0RvdChuaW1nLCBpMCwgZSkgPiBlTXEpIGkwIC09IDQ7XG4gICAgICAgIHJldHVybiBpMCArIDQ7XG4gICAgfVxuICAgIFVQTkcucXVhbnRpemUudmVjRG90ID0gZnVuY3Rpb24gKG5pbWcsIGksIGUpIHtcbiAgICAgICAgcmV0dXJuIG5pbWdbaV0gKiBlWzBdICsgbmltZ1tpICsgMV0gKiBlWzFdICsgbmltZ1tpICsgMl0gKiBlWzJdICsgbmltZ1tpICsgM10gKiBlWzNdO1xuICAgIH1cbiAgICBVUE5HLnF1YW50aXplLnN0YXRzID0gZnVuY3Rpb24gKG5pbWcsIGkwLCBpMSkge1xuICAgICAgICB2YXIgUiA9IFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXTtcbiAgICAgICAgdmFyIG0gPSBbMCwgMCwgMCwgMF07XG4gICAgICAgIHZhciBOID0gKGkxIC0gaTApID4+IDI7XG4gICAgICAgIGZvciAodmFyIGkgPSBpMDsgaSA8IGkxOyBpICs9IDQpIHtcbiAgICAgICAgICAgIHZhciByID0gbmltZ1tpXSAqICgxIC8gMjU1KSxcbiAgICAgICAgICAgICAgICBnID0gbmltZ1tpICsgMV0gKiAoMSAvIDI1NSksXG4gICAgICAgICAgICAgICAgYiA9IG5pbWdbaSArIDJdICogKDEgLyAyNTUpLFxuICAgICAgICAgICAgICAgIGEgPSBuaW1nW2kgKyAzXSAqICgxIC8gMjU1KTtcbiAgICAgICAgICAgIC8vdmFyIHIgPSBuaW1nW2ldLCBnID0gbmltZ1tpKzFdLCBiID0gbmltZ1tpKzJdLCBhID0gbmltZ1tpKzNdO1xuICAgICAgICAgICAgbVswXSArPSByO1xuICAgICAgICAgICAgbVsxXSArPSBnO1xuICAgICAgICAgICAgbVsyXSArPSBiO1xuICAgICAgICAgICAgbVszXSArPSBhO1xuXG4gICAgICAgICAgICBSWzBdICs9IHIgKiByO1xuICAgICAgICAgICAgUlsxXSArPSByICogZztcbiAgICAgICAgICAgIFJbMl0gKz0gciAqIGI7XG4gICAgICAgICAgICBSWzNdICs9IHIgKiBhO1xuICAgICAgICAgICAgUls1XSArPSBnICogZztcbiAgICAgICAgICAgIFJbNl0gKz0gZyAqIGI7XG4gICAgICAgICAgICBSWzddICs9IGcgKiBhO1xuICAgICAgICAgICAgUlsxMF0gKz0gYiAqIGI7XG4gICAgICAgICAgICBSWzExXSArPSBiICogYTtcbiAgICAgICAgICAgIFJbMTVdICs9IGEgKiBhO1xuICAgICAgICB9XG4gICAgICAgIFJbNF0gPSBSWzFdO1xuICAgICAgICBSWzhdID0gUlsyXTtcbiAgICAgICAgUls5XSA9IFJbNl07XG4gICAgICAgIFJbMTJdID0gUlszXTtcbiAgICAgICAgUlsxM10gPSBSWzddO1xuICAgICAgICBSWzE0XSA9IFJbMTFdO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBSOiBSLFxuICAgICAgICAgICAgbTogbSxcbiAgICAgICAgICAgIE46IE5cbiAgICAgICAgfTtcbiAgICB9XG4gICAgVVBORy5xdWFudGl6ZS5lc3RhdHMgPSBmdW5jdGlvbiAoc3RhdHMpIHtcbiAgICAgICAgdmFyIFIgPSBzdGF0cy5SLFxuICAgICAgICAgICAgbSA9IHN0YXRzLm0sXG4gICAgICAgICAgICBOID0gc3RhdHMuTjtcblxuICAgICAgICAvLyB3aGVuIGFsbCBzYW1wbGVzIGFyZSBlcXVhbCwgYnV0IE4gaXMgbGFyZ2UgKG1pbGxpb25zKSwgdGhlIFJqIGNhbiBiZSBub24temVybyAoIDAuMDAwMy4uLi4gLSBwcmVjaXNzaW9uIGVycm9yKVxuICAgICAgICB2YXIgbTAgPSBtWzBdLFxuICAgICAgICAgICAgbTEgPSBtWzFdLFxuICAgICAgICAgICAgbTIgPSBtWzJdLFxuICAgICAgICAgICAgbTMgPSBtWzNdLFxuICAgICAgICAgICAgaU4gPSAoTiA9PSAwID8gMCA6IDEgLyBOKTtcbiAgICAgICAgdmFyIFJqID0gW1JbMF0gLSBtMCAqIG0wICogaU4sIFJbMV0gLSBtMCAqIG0xICogaU4sIFJbMl0gLSBtMCAqIG0yICogaU4sIFJbM10gLSBtMCAqIG0zICogaU4sIFJbNF0gLSBtMSAqIG0wICogaU4sIFJbNV0gLSBtMSAqIG0xICogaU4sIFJbNl0gLSBtMSAqIG0yICogaU4sIFJbN10gLSBtMSAqIG0zICogaU4sIFJbOF0gLSBtMiAqIG0wICogaU4sIFJbOV0gLSBtMiAqIG0xICogaU4sIFJbMTBdIC0gbTIgKiBtMiAqIGlOLCBSWzExXSAtIG0yICogbTMgKiBpTiwgUlsxMl0gLSBtMyAqIG0wICogaU4sIFJbMTNdIC0gbTMgKiBtMSAqIGlOLCBSWzE0XSAtIG0zICogbTIgKiBpTiwgUlsxNV0gLSBtMyAqIG0zICogaU5dO1xuXG4gICAgICAgIHZhciBBID0gUmosXG4gICAgICAgICAgICBNID0gVVBORy5NNDtcbiAgICAgICAgdmFyIGIgPSBbMC41LCAwLjUsIDAuNSwgMC41XSxcbiAgICAgICAgICAgIG1pID0gMCxcbiAgICAgICAgICAgIHRtaSA9IDA7XG5cbiAgICAgICAgaWYgKE4gIT0gMClcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgMTA7IGkrKykge1xuICAgICAgICAgICAgICAgIGIgPSBNLm11bHRWZWMoQSwgYik7XG4gICAgICAgICAgICAgICAgdG1pID0gTWF0aC5zcXJ0KE0uZG90KGIsIGIpKTtcbiAgICAgICAgICAgICAgICBiID0gTS5zbWwoMSAvIHRtaSwgYik7XG4gICAgICAgICAgICAgICAgaWYgKE1hdGguYWJzKHRtaSAtIG1pKSA8IDFlLTkpIGJyZWFrO1xuICAgICAgICAgICAgICAgIG1pID0gdG1pO1xuICAgICAgICAgICAgfVxuICAgICAgICAvL2IgPSBbMCwwLDEsMF07ICBtaT1OO1xuICAgICAgICB2YXIgcSA9IFttMCAqIGlOLCBtMSAqIGlOLCBtMiAqIGlOLCBtMyAqIGlOXTtcbiAgICAgICAgdmFyIGVNcTI1NSA9IE0uZG90KE0uc21sKDI1NSwgcSksIGIpO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBDb3Y6IFJqLFxuICAgICAgICAgICAgcTogcSxcbiAgICAgICAgICAgIGU6IGIsXG4gICAgICAgICAgICBMOiBtaSxcbiAgICAgICAgICAgIGVNcTI1NTogZU1xMjU1LFxuICAgICAgICAgICAgZU1xOiBNLmRvdChiLCBxKSxcbiAgICAgICAgICAgIHJnYmE6ICgoKE1hdGgucm91bmQoMjU1ICogcVszXSkgPDwgMjQpIHwgKE1hdGgucm91bmQoMjU1ICogcVsyXSkgPDwgMTYpIHwgKE1hdGgucm91bmQoMjU1ICogcVsxXSkgPDwgOCkgfCAoTWF0aC5yb3VuZCgyNTUgKiBxWzBdKSA8PCAwKSkgPj4+IDApXG4gICAgICAgIH07XG4gICAgfVxuICAgIFVQTkcuTTQgPSB7XG4gICAgICAgIG11bHRWZWM6IGZ1bmN0aW9uIChtLCB2KSB7XG4gICAgICAgICAgICByZXR1cm4gW21bMF0gKiB2WzBdICsgbVsxXSAqIHZbMV0gKyBtWzJdICogdlsyXSArIG1bM10gKiB2WzNdLCBtWzRdICogdlswXSArIG1bNV0gKiB2WzFdICsgbVs2XSAqIHZbMl0gKyBtWzddICogdlszXSwgbVs4XSAqIHZbMF0gKyBtWzldICogdlsxXSArIG1bMTBdICogdlsyXSArIG1bMTFdICogdlszXSwgbVsxMl0gKiB2WzBdICsgbVsxM10gKiB2WzFdICsgbVsxNF0gKiB2WzJdICsgbVsxNV0gKiB2WzNdXTtcbiAgICAgICAgfSxcbiAgICAgICAgZG90OiBmdW5jdGlvbiAoeCwgeSkge1xuICAgICAgICAgICAgcmV0dXJuIHhbMF0gKiB5WzBdICsgeFsxXSAqIHlbMV0gKyB4WzJdICogeVsyXSArIHhbM10gKiB5WzNdO1xuICAgICAgICB9LFxuICAgICAgICBzbWw6IGZ1bmN0aW9uIChhLCB5KSB7XG4gICAgICAgICAgICByZXR1cm4gW2EgKiB5WzBdLCBhICogeVsxXSwgYSAqIHlbMl0sIGEgKiB5WzNdXTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIFVQTkcuZW5jb2RlLmNvbmNhdFJHQkEgPSBmdW5jdGlvbiAoYnVmcywgcm91bmRBbHBoYSkge1xuICAgICAgICB2YXIgdGxlbiA9IDA7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYnVmcy5sZW5ndGg7IGkrKykgdGxlbiArPSBidWZzW2ldLmJ5dGVMZW5ndGg7XG4gICAgICAgIHZhciBuaW1nID0gbmV3IFVpbnQ4QXJyYXkodGxlbiksXG4gICAgICAgICAgICBub2ZmID0gMDtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBidWZzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgaW1nID0gbmV3IFVpbnQ4QXJyYXkoYnVmc1tpXSksXG4gICAgICAgICAgICAgICAgaWwgPSBpbWcubGVuZ3RoO1xuICAgICAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBpbDsgaiArPSA0KSB7XG4gICAgICAgICAgICAgICAgdmFyIHIgPSBpbWdbal0sXG4gICAgICAgICAgICAgICAgICAgIGcgPSBpbWdbaiArIDFdLFxuICAgICAgICAgICAgICAgICAgICBiID0gaW1nW2ogKyAyXSxcbiAgICAgICAgICAgICAgICAgICAgYSA9IGltZ1tqICsgM107XG4gICAgICAgICAgICAgICAgaWYgKHJvdW5kQWxwaGEpIGEgPSAoYSAmIDEyOCkgPT0gMCA/IDAgOiAyNTU7XG4gICAgICAgICAgICAgICAgaWYgKGEgPT0gMCkgciA9IGcgPSBiID0gMDtcbiAgICAgICAgICAgICAgICBuaW1nW25vZmYgKyBqXSA9IHI7XG4gICAgICAgICAgICAgICAgbmltZ1tub2ZmICsgaiArIDFdID0gZztcbiAgICAgICAgICAgICAgICBuaW1nW25vZmYgKyBqICsgMl0gPSBiO1xuICAgICAgICAgICAgICAgIG5pbWdbbm9mZiArIGogKyAzXSA9IGE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBub2ZmICs9IGlsO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBuaW1nLmJ1ZmZlcjtcbiAgICB9XG5cbn0pKFVQTkcsIHBha28pO1xuXG5leHBvcnQgZGVmYXVsdCBVUE5HOyIsImltcG9ydCAkZ2V0RXhlTmFtZSBmcm9tICcuL2xpYi9fZ2V0RXhlTmFtZScgICAgICAgIC8vIOeUqOS6juiOt+WPlui3r+W+hOaJqeWxleWQjVxuaW1wb3J0ICRvbWdnaWYgZnJvbSAnLi9saWIvX29tZ2dpZicgICAgICAgICAgICAgICAgLy8gZ2lm5Zu+54mH57yW6Kej56CBXG5pbXBvcnQgJHVwbmdqcyBmcm9tICcuL2xpYi9fdXBuZycgICAgICAgICAgICAgICAgICAvLyBwbmflm77niYfnvJbop6PnoIFcblxuY2xhc3MgSW1hZ2V7XG4gICAgY29uc3RydWN0b3IoZXNvdXJjZSxyZXNvdXJjZXMpe1xuICAgICAgICBjb25zdCBfdHMgPSB0aGlzO1xuICAgICAgICBfdHMuZXNvdXJjZSA9IGVzb3VyY2U7XG4gICAgICAgIF90cy5yZXNvdXJjZXMgPSByZXNvdXJjZXM7XG5cbiAgICAgICAgX3RzLmluaXQoKTtcbiAgICB9XG4gICAgaW5pdCgpe1xuICAgICAgICBjb25zdCBfdHMgPSB0aGlzLFxuICAgICAgICAgICAgZXNvdXJjZSA9IF90cy5lc291cmNlLFxuICAgICAgICAgICAgcmVzb3VyY2VzID0gX3RzLnJlc291cmNlcztcblxuICAgICAgICBfdHMudGVtcCA9IHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8g5Li05pe25pWw5o2uXG4gICAgICAgICAgICAvL2xvb3A6MCwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyDkv53lrZjlvZPliY3pnIDopoHmkq3mlL7nmoTmrKHmlbBcbiAgICAgICAgICAgIC8vdGlja2VySXNBZGQ6dW5kZWZpbmVkICAgICAgICAgICAgICAgICAgICAgICAgIC8vIOS/neWtmOi9ruW+quaJp+ihjOWZqOaYr+WQpua3u+WKoFxuICAgICAgICAgICAgZXZlbnRzOnt9ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8g55So5LqO5a2Y5pS+5LqL5Lu2XG4gICAgICAgIH07XG5cbiAgICAgICAgLy8g5bGe5oCnXG4gICAgICAgIF90cy5fX2F0dHIgPSB7XG4gICAgICAgICAgICBhdXRvUGxheTp0cnVlLCAgICAgLy8g6buY6K6k6Ieq5Yqo5pKt5pS+XG4gICAgICAgICAgICBsb29wOjAgICAgICAgICAgICAgLy8g6buY6K6k5peg6ZmQ5qyh5pKt5pS+XG4gICAgICAgIH07XG5cbiAgICAgICAgLy8g5pa55rOVXG4gICAgICAgIF90cy5fX21ldGhvZCA9IHtcbiAgICAgICAgICAgIHBsYXk6X3RzLnBsYXkgICAgICAgLy8g5pKt5pS+5pa55rOVXG4gICAgICAgIH07XG5cbiAgICAgICAgLy8g54q25oCBXG4gICAgICAgIF90cy5fX3N0YXR1cyA9IHtcbiAgICAgICAgICAgIHN0YXR1czonaW5pdCcsICAgICAgLy8g54q25oCB77yM6buY6K6k5Yid5aeL5YyW77yIaW5pdOOAgXBsYXlpbmfjgIFwbGF5ZWTjgIFwYXVzZeOAgXN0b3DvvIlcbiAgICAgICAgICAgIGZyYW1lOjAsICAgICAgICAgICAgLy8g5b2T5YmN5bin5pWwXG4gICAgICAgICAgICBsb29wczowLCAgICAgICAgICAgIC8vIOi/nue7reW+queOr+aSreaUvuasoeaVsO+8jOWBnOatouaSreaUvuS8mua4hTBcbiAgICAgICAgICAgIHRpbWU6MFxuICAgICAgICB9O1xuICAgICAgICBcbiAgICAgICAgLy8g5b6q546v5omn6KGM5ZmoXG4gICAgICAgIF90cy50aWNrZXIgPSBuZXcgUElYSS5UaWNrZXIoKTtcbiAgICAgICAgX3RzLnRpY2tlci5zdG9wKCk7XG5cbiAgICAgICAgLy8g57K+54G1XG4gICAgICAgIF90cy5zcHJpdGUgPSB0aGlzLmNyZWF0ZVNwcml0ZShlc291cmNlLHJlc291cmNlcyk7XG4gICAgfVxuXG4gICAgLy8g5pKt5pS+XG4gICAgcGxheShsb29wLGNhbGxiYWNrKXtcbiAgICAgICAgY29uc3QgX3RzID0gdGhpcztcblxuICAgICAgICAvLyDmsqHmnInnurnnkIbmnZDotKjml7bmipvlh7rplJnor69cbiAgICAgICAgaWYoIV90cy50ZXh0dXJlcy5sZW5ndGgpe1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCfmsqHmnInlj6/nlKjnmoR0ZXh0dXJlcycpO1xuICAgICAgICB9O1xuXG4gICAgICAgIC8vIOe6ueeQhuadkOi0qOWPquacieS4gOW4p+aXtuS4jeW+gOS4i+aJp+ihjFxuICAgICAgICBpZihfdHMudGV4dHVyZXMubGVuZ3RoID09PSAxKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfTtcblxuICAgICAgICBsZXQgc3RhdHVzID0gX3RzLl9fc3RhdHVzLFxuICAgICAgICAgICAgYXR0ciA9IF90cy5fX2F0dHIsXG4gICAgICAgICAgICB0aW1lID0gMDtcblxuICAgICAgICAvLyDlvZPnirbmgIHmmK/lgZzmraLnmoTml7blgJnvvIzlsIbmkq3mlL7mrKHmlbDmuIUwXG4gICAgICAgIGlmKHN0YXR1cy5zdGF0dXMgPT09ICdzdG9wJyl7XG4gICAgICAgICAgICBzdGF0dXMubG9vcHMgPSAwO1xuICAgICAgICB9O1xuXG4gICAgICAgIC8vIOiuvue9ruW+queOr+WPguaVsFxuICAgICAgICBsb29wID0gdHlwZW9mIGxvb3AgPT09ICdudW1iZXInID8gbG9vcCA6IGF0dHIubG9vcDtcbiAgICAgICAgX3RzLnRlbXAubG9vcCA9IGxvb3A7XG4gICAgICAgIGF0dHIubG9vcCA9IGxvb3A7XG4gICAgICAgIFxuICAgICAgICAvLyDkuLrova7lvqrmiafooYzlmajmt7vliqDkuIDkuKrmk43kvZxcbiAgICAgICAgaWYoIV90cy50ZW1wLnRpY2tlcklzQWRkKXtcbiAgICAgICAgICAgIF90cy50aWNrZXIuYWRkKGRlbHRhVGltZSA9PiB7XG4gICAgICAgICAgICAgICAgbGV0IGVsYXBzZWQgPSBQSVhJLlRpY2tlci5zaGFyZWQuZWxhcHNlZE1TO1xuICAgICAgICAgICAgICAgIHRpbWUrPWVsYXBzZWQ7XG5cbiAgICAgICAgICAgICAgICAvLyDlvZPluKflgZznlZnml7bpl7Tlt7Lovr7liLDpl7TpmpTluKfnjofml7bmkq3mlL7kuIvkuIDluKdcbiAgICAgICAgICAgICAgICBpZih0aW1lID4gX3RzLmZyYW1lc0RlbGF5W3N0YXR1cy5mcmFtZV0pe1xuICAgICAgICAgICAgICAgICAgICBzdGF0dXMuZnJhbWUrKztcblxuICAgICAgICAgICAgICAgICAgICAvLyDkv67mlLnnirbmgIHkuLrmiafooYzkuK1cbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzLnN0YXR1cyA9ICdwbGF5aW5nJztcbiAgICBcbiAgICAgICAgICAgICAgICAgICAgLy8g5b2T5LiA5qyh5pKt5pS+5a6M5oiQ77yM5bCG5pKt5pS+5bin5b2SMO+8jOW5tuiusOW9leaSreaUvuasoeaVsFxuICAgICAgICAgICAgICAgICAgICBpZihzdGF0dXMuZnJhbWUgPiBfdHMudGV4dHVyZXMubGVuZ3RoIC0gMSl7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXMuZnJhbWUgPSAwO1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzLmxvb3BzKys7XG4gICAgXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyDlvZPmjIflrprkuobmnInmlYjnmoTmkq3mlL7mrKHmlbDlubbkuJTlvZPliY3mkq3mlL7mrKHmlbDovr7liLDmjIflrprmrKHmlbDml7bvvIzmiafooYzlm57osIPliJnlgZzmraLmkq3mlL5cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmKF90cy50ZW1wLmxvb3AgPiAwICYmIHN0YXR1cy5sb29wcyA+PSBfdHMudGVtcC5sb29wKXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZih0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicpe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYWxsYmFjayhzdGF0dXMpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8g5L+u5pS554q25oCB5Li65omn6KGM5a6M5oiQ5bm25YGc5q2iXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzLnN0YXR1cyA9ICdwbGF5ZWQnO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIF90cy5ydW5FdmVudCgncGxheWVkJyxzdGF0dXMpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIF90cy5zdG9wKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICB9O1xuICAgIFxuICAgICAgICAgICAgICAgICAgICAvLyDkv67mlLnnsr7ngbXnurnnkIbmnZDotKjkuI7lvZPliY3nmoTluKfnjofnm7jljLnphY1cbiAgICAgICAgICAgICAgICAgICAgX3RzLnNwcml0ZS50ZXh0dXJlID0gX3RzLnRleHR1cmVzW3N0YXR1cy5mcmFtZV07XG4gICAgICAgICAgICAgICAgICAgIHRpbWUgPSAwO1xuXG4gICAgICAgICAgICAgICAgICAgIF90cy5ydW5FdmVudCgncGxheWluZycsc3RhdHVzKTtcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBfdHMudGVtcC50aWNrZXJJc0FkZCA9IHRydWU7XG4gICAgICAgIH07XG4gICAgICAgIFxuICAgICAgICAvLyDorqnova7lvqrmiafooYzlmajlvIDlp4vmiafooYxcbiAgICAgICAgX3RzLnRpY2tlci5zdGFydCgpO1xuICAgIH1cblxuICAgIC8vIOaaguWBnFxuICAgIHBhdXNlKCl7XG4gICAgICAgIGNvbnN0IF90cyA9IHRoaXMsXG4gICAgICAgICAgICBzdGF0dXMgPSBfdHMuX19zdGF0dXM7XG4gICAgICAgIF90cy50aWNrZXIuc3RvcCgpO1xuICAgICAgICBzdGF0dXMuc3RhdHVzID0gJ3BhdXNlJztcbiAgICAgICAgX3RzLnJ1bkV2ZW50KCdwYXVzZScsc3RhdHVzKTtcbiAgICB9XG5cbiAgICAvLyDlgZzmraLmkq3mlL7lubbot7Poh7PnrKzkuIDluKdcbiAgICBzdG9wKCl7XG4gICAgICAgIGNvbnN0IF90cyA9IHRoaXMsXG4gICAgICAgICAgICBzdGF0dXMgPSBfdHMuX19zdGF0dXM7XG4gICAgICAgIF90cy50aWNrZXIuc3RvcCgpO1xuICAgICAgICBzdGF0dXMuc3RhdHVzID0gJ3N0b3AnOyBcbiAgICAgICAgX3RzLnJ1bkV2ZW50KCdzdG9wJyxzdGF0dXMpO1xuICAgIH1cblxuICAgIC8vIOi3s+iHs+aMh+WumueahOW4p+aVsFxuICAgIGp1bXBUb0ZyYW1lKGZyYW1lSW5kZXgpe1xuICAgICAgICBjb25zdCBfdHMgPSB0aGlzLFxuICAgICAgICAgICAgdGV4dHVyZXMgPSBfdHMudGV4dHVyZXM7XG5cbiAgICAgICAgLy8g5rKh5pyJ57q555CG5p2Q6LSo5pe25oqb5Ye66ZSZ6K+vXG4gICAgICAgIGlmKCF0ZXh0dXJlcy5sZW5ndGgpe1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCfmsqHmnInlj6/nlKjnmoR0ZXh0dXJlcycpO1xuICAgICAgICB9O1xuXG4gICAgICAgIGxldCBzdGF0dXMgPSBfdHMuX19zdGF0dXM7XG5cbiAgICAgICAgZnJhbWVJbmRleCA9IGZyYW1lSW5kZXggPCAwID8gMCA6IGZyYW1lSW5kZXggPiB0ZXh0dXJlcy5sZW5ndGggLSAxID8gdGV4dHVyZXMubGVuZ3RoIC0gMSA6IGZyYW1lSW5kZXg7XG5cbiAgICAgICAgaWYodHlwZW9mIGZyYW1lSW5kZXggPT09ICdudW1iZXInKXtcbiAgICAgICAgICAgIF90cy5zcHJpdGUudGV4dHVyZSA9IHRleHR1cmVzW2ZyYW1lSW5kZXhdO1xuICAgICAgICAgICAgc3RhdHVzLmZyYW1lID0gZnJhbWVJbmRleDtcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyDojrflj5bmgLvmkq3mlL7ml7bplb9cbiAgICBnZXREdXJhdGlvbigpe1xuICAgICAgICBjb25zdCBfdHMgPSB0aGlzLFxuICAgICAgICAgICAgZnJhbWVzRGVsYXkgPSBfdHMuZnJhbWVzRGVsYXk7XG4gICAgICAgIFxuICAgICAgICAvLyDmsqHmnInluKfml7bpl7Tml7bmipvlh7rplJnor69cbiAgICAgICAgaWYoIWZyYW1lc0RlbGF5Lmxlbmd0aCl7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ+acquaJvuWIsOWbvueJh+W4p+aXtumXtCcpO1xuICAgICAgICB9O1xuXG4gICAgICAgIGxldCB0aW1lID0gMDtcblxuICAgICAgICBmb3IobGV0IGk9MCxsZW49ZnJhbWVzRGVsYXkubGVuZ3RoOyBpPGxlbjsgaSsrKXtcbiAgICAgICAgICAgIHRpbWUgKz0gZnJhbWVzRGVsYXlbaV07XG4gICAgICAgIH07XG4gICAgICAgIHJldHVybiB0aW1lO1xuICAgIH1cblxuICAgIC8vIOiOt+WPluaAu+W4p+aVsFxuICAgIGdldEZyYW1lc0xlbmd0aCgpe1xuICAgICAgICBjb25zdCBfdHMgPSB0aGlzO1xuICAgICAgICAvLyDmsqHmnInnurnnkIbmnZDotKjml7bmipvlh7rplJnor69cbiAgICAgICAgaWYoIV90cy50ZXh0dXJlcy5sZW5ndGgpe1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCfmsqHmnInlj6/nlKjnmoR0ZXh0dXJlcycpO1xuICAgICAgICB9O1xuICAgICAgICByZXR1cm4gX3RzLnRleHR1cmVzLmxlbmd0aDtcbiAgICB9XG5cbiAgICAvLyDkuovku7ZcbiAgICBvbih0eXBlLGZ1bil7XG4gICAgICAgIGNvbnN0IF90cyA9IHRoaXM7XG5cbiAgICAgICAgc3dpdGNoICh0eXBlKSB7XG4gICAgICAgICAgICBjYXNlICdwbGF5aW5nJzpcbiAgICAgICAgICAgIGNhc2UgJ3BsYXllZCc6XG4gICAgICAgICAgICBjYXNlICdwYXVzZSc6XG4gICAgICAgICAgICBjYXNlICdzdG9wJzpcbiAgICAgICAgICAgICAgICBfdHMudGVtcC5ldmVudHNbdHlwZV0gPSBmdW47XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCfml6DmlYjnmoTkuovku7YnKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcnVuRXZlbnQodHlwZSxzdGF0dXMpe1xuICAgICAgICBsZXQgdGVtcCA9IHRoaXMudGVtcDtcbiAgICAgICAgaWYodHlwZW9mIHRlbXAuZXZlbnRzW3R5cGVdID09PSAnZnVuY3Rpb24nKXtcbiAgICAgICAgICAgIHRlbXAuZXZlbnRzW3R5cGVdKHN0YXR1cyk7XG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICog5Yib5bu657K+54G1XG4gICAgICogQHBhcmFtICB7YXJyYXk6c3RyaW5nfX0gaW1nU3JjIOWbvueJh+i1hOa6kOi3r+W+hFxuICAgICAqIEBwYXJhbSAge29iamVjdH0gcmVzb3VyY2VzIOW3sue7j+WKoOi9veeahOe8k+WtmOi1hOa6kFxuICAgICAqIEByZXR1cm4ge29iamVjdH0g6L+U5Zue57K+54G1XG4gICAgICovXG4gICAgY3JlYXRlU3ByaXRlKGVzb3VyY2UscmVzb3VyY2VzKXtcbiAgICAgICAgY29uc3QgX3RzID0gdGhpcztcblxuICAgICAgICBsZXQgU3ByaXRlID0gUElYSS5TcHJpdGUsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGltZ1NyYyA9IGVzb3VyY2UsXG4gICAgICAgICAgICBleGVOYW1lID0gJGdldEV4ZU5hbWUoaW1nU3JjLnRvTG9jYWxlTG93ZXJDYXNlKCkpO1xuICAgICAgICBcbiAgICAgICAgLy8g5paH5Lu25omp5bGV5ZCN5Li6Z2lm5oiWcG5n5YiZ6L+U5Zue5a+55bqU55qE5ZCN56ew77yM5YW25a6D5Y+N6L+U5Zueb3RoZXJcbiAgICAgICAgZXhlTmFtZSA9IGV4ZU5hbWUgPT09ICdnaWYnIHx8IGV4ZU5hbWUgPT09ICdwbmcnID8gZXhlTmFtZSA6ICdvdGhlcic7XG5cbiAgICAgICAgbGV0IGZ1bnMgPSB7XG4gICAgICAgICAgICAnZ2lmJzooKT0+e1xuICAgICAgICAgICAgICAgIGxldCBnaWZEZWNvZGVEYXRhID0gX3RzLmdpZlJlc291cmNlVG9UZXh0dXJlcyhyZXNvdXJjZXNbaW1nU3JjXSk7XG4gICAgICAgICAgICAgICAgX3RzLnRleHR1cmVzID0gZ2lmRGVjb2RlRGF0YS50ZXh0dXJlcztcbiAgICAgICAgICAgICAgICBfdHMuZnJhbWVzRGVsYXkgPSBnaWZEZWNvZGVEYXRhLmRlbGF5VGltZXM7XG4gICAgICAgICAgICAgICAgX3RzLnBsYXkoKTtcblxuICAgICAgICAgICAgICAgIC8vIOi/lOWbnueyvueBteW5tuWwhue6ueeQhuadkOi0qOiuvue9ruS4uuesrOS4gOW4p+WbvuWDj1xuICAgICAgICAgICAgICAgIHJldHVybiBuZXcgU3ByaXRlKF90cy50ZXh0dXJlc1swXSk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgJ3BuZyc6KCk9PntcbiAgICAgICAgICAgICAgICBsZXQgcG5nRGVjb2RlRGF0YSA9IF90cy5hcG5nUmVzb3VyY2VUb1RleHR1cmVzKHJlc291cmNlc1tpbWdTcmNdKTtcbiAgICAgICAgICAgICAgICBfdHMudGV4dHVyZXMgPSBwbmdEZWNvZGVEYXRhLnRleHR1cmVzO1xuICAgICAgICAgICAgICAgIF90cy5mcmFtZXNEZWxheSA9IHBuZ0RlY29kZURhdGEuZGVsYXlUaW1lcztcbiAgICAgICAgICAgICAgICBfdHMucGxheSgpO1xuXG4gICAgICAgICAgICAgICAgLy8g6L+U5Zue57K+54G15bm25bCG57q555CG5p2Q6LSo6K6+572u5Li656ys5LiA5bin5Zu+5YOPXG4gICAgICAgICAgICAgICAgcmV0dXJuIG5ldyBTcHJpdGUoX3RzLnRleHR1cmVzWzBdKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAnb3RoZXInOigpPT57XG4gICAgICAgICAgICAgICAgX3RzLnRleHR1cmVzID0gW3Jlc291cmNlc1tpbWdTcmNdLnRleHR1cmVdO1xuICAgICAgICAgICAgICAgIHJldHVybiBuZXcgU3ByaXRlKHJlc291cmNlc1tpbWdTcmNdLnRleHR1cmUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgICByZXR1cm4gZnVuc1tleGVOYW1lXSgpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIOWwhmFwbmfnvJPlrZjotYTmupDovazmjaLkuLrnurnnkIbmnZDotKhcbiAgICAgKiBAcGFyYW0gIHtvYmplY3R9IHJlc291cmNlICAgIOe8k+WtmOi1hOa6kFxuICAgICAqIEByZXR1cm4ge29iamVjdH0g6L+U5Zue5LiA5Liq5a+56LGh77yM5YyF5ousYXBuZ+eahOavj+W4p+aXtumVv+WPiuino+eggeWHuuadpeadkOi0qFxuICAgICAqL1xuICAgIGFwbmdSZXNvdXJjZVRvVGV4dHVyZXMocmVzb3VyY2Upe1xuICAgICAgICBjb25zdCBfdHMgPSB0aGlzO1xuXG4gICAgICAgIGxldCBvYmogPSB7XG4gICAgICAgICAgICAgICAgZGVsYXlUaW1lczpbXSxcbiAgICAgICAgICAgICAgICB0ZXh0dXJlczpbXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGJ1ZiA9IG5ldyBVaW50OEFycmF5KHJlc291cmNlLmRhdGEpLFxuICAgICAgICAgICAgdXBuZyA9ICR1cG5nanMuZGVjb2RlKGJ1ZiksXG4gICAgICAgICAgICByZ2JhID0gJHVwbmdqcy50b1JHQkE4KHVwbmcpLFxuICAgICAgICAgICAgcG5nV2lkdGggPSB1cG5nLndpZHRoLFxuICAgICAgICAgICAgcG5nSGVpZ2h0ID0gdXBuZy5oZWlnaHQsXG4gICAgICAgICAgICBwbmdGcmFtZXNMZW4gPSB1cG5nLmZyYW1lcy5sZW5ndGgsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHNwcml0ZVNoZWV0LFxuICAgICAgICAgICAgY2FudmFzLFxuICAgICAgICAgICAgY3R4LFxuICAgICAgICAgICAgaW1hZ2VEYXRhO1xuXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgLy8g6K6w5b2V5LiL5q+P5bin55qE5pe26Ze0XG4gICAgICAgIHVwbmcuZnJhbWVzLmZvckVhY2goKGl0ZW0saW5kZXgpPT57XG4gICAgICAgICAgICBvYmouZGVsYXlUaW1lcy5wdXNoKGl0ZW0uZGVsYXkpO1xuICAgICAgICB9KTtcblxuICAgICAgICBmb3IobGV0IGk9MCxsZW49cmdiYS5sZW5ndGg7IGk8bGVuOyBpKyspe1xuICAgICAgICAgICAgbGV0IGl0ZW0gPSByZ2JhW2ldLFxuICAgICAgICAgICAgICAgIGRhdGEgPSBuZXcgVWludDhDbGFtcGVkQXJyYXkoaXRlbSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGNhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xuICAgICAgICAgICAgY2FudmFzLndpZHRoID0gcG5nV2lkdGg7XG4gICAgICAgICAgICBjYW52YXMuaGVpZ2h0ID0gcG5nSGVpZ2h0O1xuICAgICAgICAgICAgY3R4ID0gY2FudmFzLmdldENvbnRleHQoJzJkJyk7XG4gICAgICAgICAgICBzcHJpdGVTaGVldCA9IG5ldyBQSVhJLkJhc2VUZXh0dXJlLmZyb20oY2FudmFzKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaW1hZ2VEYXRhID0gY3R4LmNyZWF0ZUltYWdlRGF0YShwbmdXaWR0aCxwbmdIZWlnaHQpO1xuICAgICAgICAgICAgaW1hZ2VEYXRhLmRhdGEuc2V0KGRhdGEpO1xuICAgICAgICAgICAgY3R4LnB1dEltYWdlRGF0YShpbWFnZURhdGEsMCwwKTtcblxuICAgICAgICAgICAgb2JqLnRleHR1cmVzLnB1c2gobmV3IFBJWEkuVGV4dHVyZShzcHJpdGVTaGVldCxuZXcgUElYSS5SZWN0YW5nbGUoMCwgMCwgcG5nV2lkdGgsIHBuZ0hlaWdodCkpKTtcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGNhbnZhcyk7XG4gICAgICAgIHJldHVybiBvYmo7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICog5bCGZ2lm57yT5a2Y6LWE5rqQ6L2s5o2i5Li657q555CG5p2Q6LSoXG4gICAgICogQHBhcmFtICB7b2JqZWN0fSByZXNvdXJjZSAgICDnvJPlrZjotYTmupBcbiAgICAgKiBAcmV0dXJuIHtvYmplY3R9IOi/lOWbnuS4gOS4quWvueixoe+8jOWMheaLrGFwbmfnmoTmr4/luKfml7bplb/lj4rop6PnoIHlh7rmnaXmnZDotKhcbiAgICAgKi9cbiAgICBnaWZSZXNvdXJjZVRvVGV4dHVyZXMocmVzb3VyY2Upe1xuICAgICAgICBjb25zdCBfdHMgPSB0aGlzO1xuXG4gICAgICAgIGxldCBvYmogPSB7XG4gICAgICAgICAgICAgICAgZGVsYXlUaW1lczpbXSxcbiAgICAgICAgICAgICAgICB0ZXh0dXJlczpbXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGJ1ZiA9IG5ldyBVaW50OEFycmF5KHJlc291cmNlLmRhdGEpLFxuICAgICAgICAgICAgZ2lmID0gbmV3ICRvbWdnaWYoYnVmKSxcbiAgICAgICAgICAgIGdpZldpZHRoID0gZ2lmLndpZHRoLFxuICAgICAgICAgICAgZ2lmSGVpZ2h0ID0gZ2lmLmhlaWdodCxcbiAgICAgICAgICAgIGdpZkZyYW1lc0xlbiA9IGdpZi5udW1GcmFtZXMoKSxcbiAgICAgICAgICAgIGdpZkZyYW1lSW5mbyxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgc3ByaXRlU2hlZXQsXG4gICAgICAgICAgICBjYW52YXMsXG4gICAgICAgICAgICBjdHgsXG4gICAgICAgICAgICBpbWFnZURhdGE7XG4gICAgICAgIFxuICAgICAgICBcblxuICAgICAgICBmb3IobGV0IGk9MDsgaTxnaWZGcmFtZXNMZW47IGkrKyl7XG4gICAgICAgICAgICAvL+W+l+WIsOavj+W4p+eahOS/oeaBr+W5tuWwhuW4p+W7tui/n+S/oeaBr+S/neWtmOi1t+adpVxuICAgICAgICAgICAgZ2lmRnJhbWVJbmZvID0gZ2lmLmZyYW1lSW5mbyhpKTtcbiAgICAgICAgICAgIG9iai5kZWxheVRpbWVzLnB1c2goZ2lmRnJhbWVJbmZvLmRlbGF5ICogMTApO1xuXG4gICAgICAgICAgICBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcbiAgICAgICAgICAgIGNhbnZhcy53aWR0aCA9IGdpZldpZHRoO1xuICAgICAgICAgICAgY2FudmFzLmhlaWdodCA9IGdpZkhlaWdodDtcbiAgICAgICAgICAgIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuXG4gICAgICAgICAgICAvL+WIm+W7uuS4gOWdl+epuueZveeahEltYWdlRGF0YeWvueixoVxuICAgICAgICAgICAgaW1hZ2VEYXRhID0gY3R4LmNyZWF0ZUltYWdlRGF0YShnaWZXaWR0aCwgZ2lmSGVpZ2h0KTtcblxuICAgICAgICAgICAgLy/lsIbnrKzkuIDluKfovazmjaLkuLpSR0JB5YC877yM5bCG6LWL5LqI5Yiw5Zu+5YOP5Yy6XG4gICAgICAgICAgICBnaWYuZGVjb2RlQW5kQmxpdEZyYW1lUkdCQShpLGltYWdlRGF0YS5kYXRhKTtcblxuICAgICAgICAgICAgLy/lsIbkuIrpnaLliJvlu7rnmoTlm77lg4/mlbDmja7mlL7lm57liLDnlLvpnaLkuIpcbiAgICAgICAgICAgIGN0eC5wdXRJbWFnZURhdGEoaW1hZ2VEYXRhLCAwLCAwKTtcblxuICAgICAgICAgICAgc3ByaXRlU2hlZXQgPSBuZXcgUElYSS5CYXNlVGV4dHVyZS5mcm9tQ2FudmFzKGNhbnZhcyk7XG4gICAgICAgICAgICBvYmoudGV4dHVyZXMucHVzaChuZXcgUElYSS5UZXh0dXJlKHNwcml0ZVNoZWV0LG5ldyBQSVhJLlJlY3RhbmdsZSgwLCAwLCBnaWZXaWR0aCwgZ2lmSGVpZ2h0KSkpO1xuICAgICAgICB9O1xuICAgICAgICAvLyBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGNhbnZhcyk7XG4gICAgICAgIHJldHVybiBvYmo7XG4gICAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBJbWFnZTsiLCJpbXBvcnQgJGFwbmdBbmRHaWYgZnJvbSAnLi9QaXhpQXBuZ0FuZEdpZidcblxuY29uc3QgYXBwID0gbmV3IFBJWEkuQXBwbGljYXRpb24oKTtcblxuY29uc3QgbG9hZGVyID0gUElYSS5sb2FkZXIsXG4gICAgdGl0bGUgPSBkb2N1bWVudC50aXRsZSxcbiAgICBsb2FkT3B0aW9uID0ge1xuICAgICAgICBsb2FkVHlwZTogUElYSS5sb2FkZXJzLlJlc291cmNlLkxPQURfVFlQRS5YSFIsXG4gICAgICAgIHhoclR5cGU6IFBJWEkubG9hZGVycy5SZXNvdXJjZS5YSFJfUkVTUE9OU0VfVFlQRS5CVUZGRVIsXG4gICAgICAgIGNyb3NzT3JpZ2luOicnXG4gICAgfSxcbiAgICBpbWdzID0ge1xuICAgICAgICBnaWY6J2h0dHA6Ly9pc3BhcnRhLmdpdGh1Yi5pby9jb21wYXJlL2ltYWdlL2Rvbmd0YWkvZ2lmLzEuZ2lmJyxcbiAgICAgICAgYXBuZzonaHR0cDovL2lzcGFydGEuZ2l0aHViLmlvL2NvbXBhcmUvaW1hZ2UvZG9uZ3RhaS9hcG5nLzEucG5nJ1xuICAgICAgICAvLyBnaWY6Jy4vMS5naWYnLFxuICAgICAgICAvLyBhcG5nOicuLzEucG5nJ1xuICAgIH07XG5cblxubG9hZGVyLmFkZChpbWdzLmdpZixsb2FkT3B0aW9uKTtcbmxvYWRlci5hZGQoaW1ncy5hcG5nLGxvYWRPcHRpb24pO1xuXG5sb2FkZXIub24oJ3Byb2dyZXNzJywobG9hZGVyLHJlc291cmUpPT57XG4gICAgZG9jdW1lbnQudGl0bGUgPSBNYXRoLnJvdW5kKGxvYWRlci5wcm9ncmVzcyk7XG59KS5sb2FkKChwcm9ncmVzcyxyZXNvdXJjZXMpPT57XG4gICAgZG9jdW1lbnQudGl0bGUgPSB0aXRsZTtcblxuICAgIHdpbmRvdy5naWYgPSBuZXcgJGFwbmdBbmRHaWYoaW1ncy5naWYscmVzb3VyY2VzKTtcbiAgICB3aW5kb3cuYXBuZyA9IG5ldyAkYXBuZ0FuZEdpZihpbWdzLmFwbmcscmVzb3VyY2VzKTtcblxuICAgIGxldCBnaWZTcHJpdGUgPSB3aW5kb3cuZ2lmLnNwcml0ZSxcbiAgICAgICAgYXBuZ1Nwcml0ZSA9IHdpbmRvdy5hcG5nLnNwcml0ZTtcblxuICAgIGdpZlNwcml0ZS54ID0gMTAwO1xuICAgIGFwbmdTcHJpdGUueCA9IDQ1MDtcblxuICAgIGdpZlNwcml0ZS55ID0gMTYwO1xuICAgIGFwbmdTcHJpdGUueSA9IDE2MDtcblxuICAgIGFwcC5zdGFnZS5hZGRDaGlsZChnaWZTcHJpdGUpO1xuICAgIGFwcC5zdGFnZS5hZGRDaGlsZChhcG5nU3ByaXRlKTtcbn0pO1xuXG5kb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGFwcC52aWV3KTsiXSwibmFtZXMiOlsicGFrbyIsIiR1cG5nanMiLCIkb21nZ2lmIiwiJGFwbmdBbmRHaWYiXSwibWFwcGluZ3MiOiI7Ozs7O0FBQUEsdUJBQWUsVUFBQyxRQUFRO1FBQ3BCLElBQUksS0FBSyxHQUFHLFFBQVEsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDaEMsT0FBTyxLQUFLLENBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQztJQUNuQyxDQUFDLEVBQUM7O0lDSEY7QUFDQSxJQTJCQSxtQkFBbUIsR0FBRztRQUNwQixJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7O1FBR1YsSUFBSSxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsS0FBSyxJQUFJLElBQUksR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLEtBQUssSUFBSSxJQUFJLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxLQUFLLElBQUk7WUFDN0QsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLEtBQUssSUFBSSxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxHQUFHLElBQUksTUFBTSxJQUFJLElBQUksR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLEtBQUssSUFBSSxFQUFFO1lBQzFFLE1BQU0sSUFBSSxLQUFLLENBQUMsNkJBQTZCLENBQUMsQ0FBQztTQUNoRDs7UUFHRCxJQUFJLEtBQUssR0FBRyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDckMsSUFBSSxNQUFNLEdBQUcsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3RDLElBQUksR0FBRyxHQUFHLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ25CLElBQUksbUJBQW1CLEdBQUcsR0FBRyxJQUFJLENBQUMsQ0FBQztRQUNuQyxJQUFJLHNCQUFzQixHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUM7UUFDdkMsSUFBSSxpQkFBaUIsR0FBRyxDQUFDLEtBQUssc0JBQXNCLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFDMUQsSUFBSSxVQUFVLEdBQUcsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDMUIsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7UUFFVCxJQUFJLHFCQUFxQixHQUFHLElBQUksQ0FBQztRQUNqQyxJQUFJLG1CQUFtQixHQUFHLElBQUksQ0FBQztRQUUvQixJQUFJLG1CQUFtQixFQUFFO1lBQ3ZCLHFCQUFxQixHQUFHLENBQUMsQ0FBQztZQUMxQixtQkFBbUIsR0FBRyxpQkFBaUIsQ0FBQztZQUN4QyxDQUFDLElBQUksaUJBQWlCLEdBQUcsQ0FBQyxDQUFDO1NBQzVCO1FBRUQsSUFBSSxNQUFNLEdBQUcsSUFBSSxDQUFDO1FBRWxCLElBQUksTUFBTSxHQUFHLEVBQUUsQ0FBQztRQUVoQixJQUFJLEtBQUssR0FBRyxDQUFDLENBQUM7UUFDZCxJQUFJLGlCQUFpQixHQUFHLElBQUksQ0FBQztRQUM3QixJQUFJLFFBQVEsR0FBRyxDQUFDLENBQUM7UUFDakIsSUFBSSxVQUFVLEdBQUcsSUFBSSxDQUFDO1FBRXRCLElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDO1FBQ25CLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDO1FBRXJCLE9BQU8sTUFBTSxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUMsTUFBTSxFQUFFO1lBQy9CLFFBQVEsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUNkLEtBQUssSUFBSTtvQkFDUCxRQUFRLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQzt3QkFDZCxLQUFLLElBQUk7OzRCQUVQLElBQUksR0FBRyxDQUFDLENBQUMsQ0FBQyxLQUFLLElBQUk7O2dDQUVqQixHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLElBQUksSUFBSSxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLElBQUksSUFBSSxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLElBQUk7b0NBQzlELEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksSUFBSSxJQUFJLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksSUFBSSxJQUFJLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksSUFBSTtvQ0FDOUQsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxJQUFJLElBQUksR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxJQUFJLElBQUksR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxJQUFJO29DQUM5RCxHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxJQUFJLElBQUksSUFBSSxHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxJQUFJLElBQUk7O29DQUUxQyxHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxJQUFJLElBQUksSUFBSSxHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxJQUFJLElBQUksSUFBSSxHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUMsRUFBRTtnQ0FDaEUsQ0FBQyxJQUFJLEVBQUUsQ0FBQztnQ0FDUixVQUFVLEdBQUcsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDO2dDQUN0QyxDQUFDLEVBQUUsQ0FBQzs2QkFDTDtpQ0FBTTtnQ0FDTCxDQUFDLElBQUksRUFBRSxDQUFDO2dDQUNSLE9BQU8sSUFBSSxFQUFFO29DQUNYLElBQUksVUFBVSxHQUFHLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDOztvQ0FFMUIsSUFBSSxFQUFFLFVBQVUsSUFBSSxDQUFDLENBQUM7d0NBQUUsTUFBTSxLQUFLLENBQUMsb0JBQW9CLENBQUMsQ0FBQztvQ0FDMUQsSUFBSSxVQUFVLEtBQUssQ0FBQzt3Q0FBRSxNQUFNO29DQUM1QixDQUFDLElBQUksVUFBVSxDQUFDO2lDQUNqQjs2QkFDRjs0QkFDRCxNQUFNO3dCQUVSLEtBQUssSUFBSTs0QkFDUCxJQUFJLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxLQUFLLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUM7Z0NBQ3RDLE1BQU0sSUFBSSxLQUFLLENBQUMsbUNBQW1DLENBQUMsQ0FBQzs0QkFDdkQsSUFBSSxHQUFHLEdBQUcsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7NEJBQ25CLEtBQUssR0FBRyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUM7NEJBQ2pDLGlCQUFpQixHQUFHLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDOzRCQUM3QixJQUFJLENBQUMsR0FBRyxHQUFHLENBQUMsTUFBTSxDQUFDO2dDQUFFLGlCQUFpQixHQUFHLElBQUksQ0FBQzs0QkFDOUMsUUFBUSxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDOzRCQUMxQixDQUFDLEVBQUUsQ0FBQzs0QkFDSixNQUFNO3dCQUVSLEtBQUssSUFBSTs0QkFDUCxPQUFPLElBQUksRUFBRTtnQ0FDWCxJQUFJLFVBQVUsR0FBRyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQzs7Z0NBRTFCLElBQUksRUFBRSxVQUFVLElBQUksQ0FBQyxDQUFDO29DQUFFLE1BQU0sS0FBSyxDQUFDLG9CQUFvQixDQUFDLENBQUM7Z0NBQzFELElBQUksVUFBVSxLQUFLLENBQUM7b0NBQUUsTUFBTTs7Z0NBRTVCLENBQUMsSUFBSSxVQUFVLENBQUM7NkJBQ2pCOzRCQUNELE1BQU07d0JBRVI7NEJBQ0UsTUFBTSxJQUFJLEtBQUssQ0FDYixtQ0FBbUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO3FCQUNwRTtvQkFDRCxNQUFNO2dCQUVSLEtBQUssSUFBSTtvQkFDUCxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUM7b0JBQ2pDLElBQUksQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQztvQkFDakMsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDO29CQUNqQyxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUM7b0JBQ2pDLElBQUksR0FBRyxHQUFHLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO29CQUNuQixJQUFJLGtCQUFrQixHQUFHLEdBQUcsSUFBSSxDQUFDLENBQUM7b0JBQ2xDLElBQUksY0FBYyxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO29CQUNsQyxJQUFJLHFCQUFxQixHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUM7b0JBQ3RDLElBQUksZ0JBQWdCLEdBQUcsQ0FBQyxLQUFLLHFCQUFxQixHQUFHLENBQUMsQ0FBQyxDQUFDO29CQUN4RCxJQUFJLGNBQWMsR0FBRyxxQkFBcUIsQ0FBQztvQkFDM0MsSUFBSSxZQUFZLEdBQUcsbUJBQW1CLENBQUM7b0JBQ3ZDLElBQUksaUJBQWlCLEdBQUcsS0FBSyxDQUFDO29CQUM5QixJQUFJLGtCQUFrQixFQUFFO3dCQUN0QixJQUFJLGlCQUFpQixHQUFHLElBQUksQ0FBQzt3QkFDN0IsY0FBYyxHQUFHLENBQUMsQ0FBQzt3QkFDbkIsWUFBWSxHQUFHLGdCQUFnQixDQUFDO3dCQUNoQyxDQUFDLElBQUksZ0JBQWdCLEdBQUcsQ0FBQyxDQUFDO3FCQUMzQjtvQkFFRCxJQUFJLFdBQVcsR0FBRyxDQUFDLENBQUM7b0JBRXBCLENBQUMsRUFBRSxDQUFDO29CQUNKLE9BQU8sSUFBSSxFQUFFO3dCQUNYLElBQUksVUFBVSxHQUFHLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDOzt3QkFFMUIsSUFBSSxFQUFFLFVBQVUsSUFBSSxDQUFDLENBQUM7NEJBQUUsTUFBTSxLQUFLLENBQUMsb0JBQW9CLENBQUMsQ0FBQzt3QkFDMUQsSUFBSSxVQUFVLEtBQUssQ0FBQzs0QkFBRSxNQUFNO3dCQUM1QixDQUFDLElBQUksVUFBVSxDQUFDO3FCQUNqQjtvQkFFRCxNQUFNLENBQUMsSUFBSSxDQUFDO3dCQUNWLENBQUMsRUFBRSxDQUFDO3dCQUNKLENBQUMsRUFBRSxDQUFDO3dCQUNKLEtBQUssRUFBRSxDQUFDO3dCQUNSLE1BQU0sRUFBRSxDQUFDO3dCQUNULGlCQUFpQixFQUFFLGlCQUFpQjt3QkFDcEMsY0FBYyxFQUFFLGNBQWM7d0JBQzlCLFlBQVksRUFBRSxZQUFZO3dCQUMxQixXQUFXLEVBQUUsV0FBVzt3QkFDeEIsV0FBVyxFQUFFLENBQUMsR0FBRyxXQUFXO3dCQUM1QixpQkFBaUIsRUFBRSxpQkFBaUI7d0JBQ3BDLFVBQVUsRUFBRSxDQUFDLENBQUMsY0FBYzt3QkFDNUIsS0FBSyxFQUFFLEtBQUs7d0JBQ1osUUFBUSxFQUFFLFFBQVE7cUJBQ25CLENBQUMsQ0FBQztvQkFDSCxNQUFNO2dCQUVSLEtBQUssSUFBSTtvQkFDUCxNQUFNLEdBQUcsS0FBSyxDQUFDO29CQUNmLE1BQU07Z0JBRVI7b0JBQ0UsTUFBTSxJQUFJLEtBQUssQ0FBQyx1QkFBdUIsR0FBRyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO29CQUNuRSxNQUFNO2FBQ1Q7U0FDRjtRQUVELElBQUksQ0FBQyxTQUFTLEdBQUc7WUFDZixPQUFPLE1BQU0sQ0FBQyxNQUFNLENBQUM7U0FDdEIsQ0FBQztRQUVGLElBQUksQ0FBQyxTQUFTLEdBQUc7WUFDZixPQUFPLFVBQVUsQ0FBQztTQUNuQixDQUFDO1FBRUYsSUFBSSxDQUFDLFNBQVMsR0FBRyxVQUFVLFNBQVM7WUFDbEMsSUFBSSxTQUFTLEdBQUcsQ0FBQyxJQUFJLFNBQVMsSUFBSSxNQUFNLENBQUMsTUFBTTtnQkFDN0MsTUFBTSxJQUFJLEtBQUssQ0FBQywyQkFBMkIsQ0FBQyxDQUFDO1lBQy9DLE9BQU8sTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1NBQzFCLENBQUE7UUFFRCxJQUFJLENBQUMsc0JBQXNCLEdBQUcsVUFBVSxTQUFTLEVBQUUsTUFBTTtZQUN2RCxJQUFJLEtBQUssR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1lBQ3RDLElBQUksVUFBVSxHQUFHLEtBQUssQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDLE1BQU0sQ0FBQztZQUM1QyxJQUFJLFlBQVksR0FBRyxJQUFJLFVBQVUsQ0FBQyxVQUFVLENBQUMsQ0FBQztZQUM5Qyw2QkFBNkIsQ0FDM0IsR0FBRyxFQUFFLEtBQUssQ0FBQyxXQUFXLEVBQUUsWUFBWSxFQUFFLFVBQVUsQ0FBQyxDQUFDO1lBQ3BELElBQUksY0FBYyxHQUFHLEtBQUssQ0FBQyxjQUFjLENBQUM7Ozs7WUFLMUMsSUFBSSxLQUFLLEdBQUcsS0FBSyxDQUFDLGlCQUFpQixDQUFDO1lBQ3BDLElBQUksS0FBSyxLQUFLLElBQUk7Z0JBQUUsS0FBSyxHQUFHLEdBQUcsQ0FBQzs7OztZQUtoQyxJQUFJLFVBQVUsR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDO1lBQzdCLElBQUksV0FBVyxHQUFHLEtBQUssR0FBRyxVQUFVLENBQUM7WUFDckMsSUFBSSxLQUFLLEdBQUcsVUFBVSxDQUFDOztZQUd2QixJQUFJLEtBQUssR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsR0FBRyxLQUFLLElBQUksS0FBSyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDOUMsSUFBSSxLQUFLLEdBQUcsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLEdBQUcsS0FBSyxDQUFDLE1BQU0sSUFBSSxLQUFLLEdBQUcsS0FBSyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDN0QsSUFBSSxFQUFFLEdBQUcsS0FBSyxDQUFDO1lBRWYsSUFBSSxVQUFVLEdBQUcsV0FBVyxHQUFHLENBQUMsQ0FBQzs7O1lBSWpDLElBQUksS0FBSyxDQUFDLFVBQVUsS0FBSyxJQUFJLEVBQUU7Z0JBQzdCLFVBQVUsSUFBSSxLQUFLLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQzthQUM3QjtZQUVELElBQUksYUFBYSxHQUFHLENBQUMsQ0FBQztZQUV0QixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFLEdBQUcsWUFBWSxDQUFDLE1BQU0sRUFBRSxDQUFDLEdBQUcsRUFBRSxFQUFFLEVBQUUsQ0FBQyxFQUFFO2dCQUNyRCxJQUFJLEtBQUssR0FBRyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBRTVCLElBQUksS0FBSyxLQUFLLENBQUMsRUFBRTtvQkFDZixFQUFFLElBQUksVUFBVSxDQUFDO29CQUNqQixLQUFLLEdBQUcsVUFBVSxDQUFDO29CQUNuQixJQUFJLEVBQUUsSUFBSSxLQUFLLEVBQUU7d0JBQ2YsVUFBVSxHQUFHLFdBQVcsR0FBRyxDQUFDLEdBQUcsS0FBSyxHQUFHLENBQUMsSUFBSSxhQUFhLEdBQUcsQ0FBQyxDQUFDLENBQUM7O3dCQUUvRCxFQUFFLEdBQUcsS0FBSyxHQUFHLENBQUMsVUFBVSxHQUFHLFdBQVcsS0FBSyxhQUFhLElBQUksQ0FBQyxDQUFDLENBQUM7d0JBQy9ELGFBQWEsS0FBSyxDQUFDLENBQUM7cUJBQ3JCO2lCQUNGO2dCQUVELElBQUksS0FBSyxLQUFLLEtBQUssRUFBRTtvQkFDbkIsRUFBRSxJQUFJLENBQUMsQ0FBQztpQkFDVDtxQkFBTTtvQkFDTCxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUMsY0FBYyxHQUFHLEtBQUssR0FBRyxDQUFDLENBQUMsQ0FBQztvQkFDeEMsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDLGNBQWMsR0FBRyxLQUFLLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO29CQUM1QyxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUMsY0FBYyxHQUFHLEtBQUssR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7b0JBQzVDLE1BQU0sQ0FBQyxFQUFFLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQztvQkFDakIsTUFBTSxDQUFDLEVBQUUsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDO29CQUNqQixNQUFNLENBQUMsRUFBRSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUM7b0JBQ2pCLE1BQU0sQ0FBQyxFQUFFLEVBQUUsQ0FBQyxHQUFHLEdBQUcsQ0FBQztpQkFDcEI7Z0JBQ0QsRUFBRSxLQUFLLENBQUM7YUFDVDtTQUNGLENBQUM7O1FBR0YsSUFBSSxDQUFDLHNCQUFzQixHQUFHLFVBQVUsU0FBUyxFQUFFLE1BQU07WUFDdkQsSUFBSSxLQUFLLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsQ0FBQztZQUN0QyxJQUFJLFVBQVUsR0FBRyxLQUFLLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUM7WUFDNUMsSUFBSSxZQUFZLEdBQUcsSUFBSSxVQUFVLENBQUMsVUFBVSxDQUFDLENBQUM7WUFDOUMsNkJBQTZCLENBQzNCLEdBQUcsRUFBRSxLQUFLLENBQUMsV0FBVyxFQUFFLFlBQVksRUFBRSxVQUFVLENBQUMsQ0FBQztZQUNwRCxJQUFJLGNBQWMsR0FBRyxLQUFLLENBQUMsY0FBYyxDQUFDOzs7O1lBSzFDLElBQUksS0FBSyxHQUFHLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQztZQUNwQyxJQUFJLEtBQUssS0FBSyxJQUFJO2dCQUFFLEtBQUssR0FBRyxHQUFHLENBQUM7Ozs7WUFLaEMsSUFBSSxVQUFVLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQztZQUM3QixJQUFJLFdBQVcsR0FBRyxLQUFLLEdBQUcsVUFBVSxDQUFDO1lBQ3JDLElBQUksS0FBSyxHQUFHLFVBQVUsQ0FBQzs7WUFHdkIsSUFBSSxLQUFLLEdBQUcsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLEdBQUcsS0FBSyxJQUFJLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQzlDLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBQyxNQUFNLElBQUksS0FBSyxHQUFHLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQzdELElBQUksRUFBRSxHQUFHLEtBQUssQ0FBQztZQUVmLElBQUksVUFBVSxHQUFHLFdBQVcsR0FBRyxDQUFDLENBQUM7OztZQUlqQyxJQUFJLEtBQUssQ0FBQyxVQUFVLEtBQUssSUFBSSxFQUFFO2dCQUM3QixVQUFVLElBQUksS0FBSyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7YUFDN0I7WUFFRCxJQUFJLGFBQWEsR0FBRyxDQUFDLENBQUM7WUFFdEIsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsRUFBRSxHQUFHLFlBQVksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxHQUFHLEVBQUUsRUFBRSxFQUFFLENBQUMsRUFBRTtnQkFDckQsSUFBSSxLQUFLLEdBQUcsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUU1QixJQUFJLEtBQUssS0FBSyxDQUFDLEVBQUU7b0JBQ2YsRUFBRSxJQUFJLFVBQVUsQ0FBQztvQkFDakIsS0FBSyxHQUFHLFVBQVUsQ0FBQztvQkFDbkIsSUFBSSxFQUFFLElBQUksS0FBSyxFQUFFO3dCQUNmLFVBQVUsR0FBRyxXQUFXLEdBQUcsQ0FBQyxHQUFHLEtBQUssR0FBRyxDQUFDLElBQUksYUFBYSxHQUFHLENBQUMsQ0FBQyxDQUFDOzt3QkFFL0QsRUFBRSxHQUFHLEtBQUssR0FBRyxDQUFDLFVBQVUsR0FBRyxXQUFXLEtBQUssYUFBYSxJQUFJLENBQUMsQ0FBQyxDQUFDO3dCQUMvRCxhQUFhLEtBQUssQ0FBQyxDQUFDO3FCQUNyQjtpQkFDRjtnQkFFRCxJQUFJLEtBQUssS0FBSyxLQUFLLEVBQUU7b0JBQ25CLEVBQUUsSUFBSSxDQUFDLENBQUM7aUJBQ1Q7cUJBQU07b0JBQ0wsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDLGNBQWMsR0FBRyxLQUFLLEdBQUcsQ0FBQyxDQUFDLENBQUM7b0JBQ3hDLElBQUksQ0FBQyxHQUFHLEdBQUcsQ0FBQyxjQUFjLEdBQUcsS0FBSyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztvQkFDNUMsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDLGNBQWMsR0FBRyxLQUFLLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO29CQUM1QyxNQUFNLENBQUMsRUFBRSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUM7b0JBQ2pCLE1BQU0sQ0FBQyxFQUFFLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQztvQkFDakIsTUFBTSxDQUFDLEVBQUUsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDO29CQUNqQixNQUFNLENBQUMsRUFBRSxFQUFFLENBQUMsR0FBRyxHQUFHLENBQUM7aUJBQ3BCO2dCQUNELEVBQUUsS0FBSyxDQUFDO2FBQ1Q7U0FDRixDQUFDO0lBQ0osQ0FBQztJQUVELHVDQUF1QyxXQUFXLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRSxhQUFhO1FBQzFFLElBQUksYUFBYSxHQUFHLFdBQVcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBRXJDLElBQUksVUFBVSxHQUFHLENBQUMsSUFBSSxhQUFhLENBQUM7UUFDcEMsSUFBSSxRQUFRLEdBQUcsVUFBVSxHQUFHLENBQUMsQ0FBQztRQUM5QixJQUFJLFNBQVMsR0FBRyxRQUFRLEdBQUcsQ0FBQyxDQUFDO1FBRTdCLElBQUksYUFBYSxHQUFHLGFBQWEsR0FBRyxDQUFDLENBQUM7OztRQUd0QyxJQUFJLFNBQVMsR0FBRyxDQUFDLENBQUMsSUFBSSxhQUFhLElBQUksQ0FBQyxDQUFDO1FBQ3pDLElBQUksU0FBUyxHQUFHLENBQUMsQ0FBQztRQUNsQixJQUFJLEdBQUcsR0FBRyxDQUFDLENBQUM7UUFFWixJQUFJLEVBQUUsR0FBRyxDQUFDLENBQUM7UUFFWCxJQUFJLGFBQWEsR0FBRyxXQUFXLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQzs7OztRQUtyQyxJQUFJLFVBQVUsR0FBRyxJQUFJLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUV0QyxJQUFJLFNBQVMsR0FBRyxJQUFJLENBQUM7UUFFckIsT0FBTyxJQUFJLEVBQUU7O1lBRVgsT0FBTyxTQUFTLEdBQUcsRUFBRSxFQUFFO2dCQUNyQixJQUFJLGFBQWEsS0FBSyxDQUFDO29CQUFFLE1BQU07Z0JBRS9CLEdBQUcsSUFBSSxXQUFXLENBQUMsQ0FBQyxFQUFFLENBQUMsSUFBSSxTQUFTLENBQUM7Z0JBQ3JDLFNBQVMsSUFBSSxDQUFDLENBQUM7Z0JBRWYsSUFBSSxhQUFhLEtBQUssQ0FBQyxFQUFFO29CQUN2QixhQUFhLEdBQUcsV0FBVyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7aUJBQ2xDO3FCQUFNO29CQUNMLEVBQUUsYUFBYSxDQUFDO2lCQUNqQjthQUNGOzs7WUFJRCxJQUFJLFNBQVMsR0FBRyxhQUFhO2dCQUMzQixNQUFNO1lBRVIsSUFBSSxJQUFJLEdBQUcsR0FBRyxHQUFHLFNBQVMsQ0FBQztZQUMzQixHQUFHLEtBQUssYUFBYSxDQUFDO1lBQ3RCLFNBQVMsSUFBSSxhQUFhLENBQUM7Ozs7WUFLM0IsSUFBSSxJQUFJLEtBQUssVUFBVSxFQUFFOzs7O2dCQUt2QixTQUFTLEdBQUcsUUFBUSxHQUFHLENBQUMsQ0FBQztnQkFDekIsYUFBYSxHQUFHLGFBQWEsR0FBRyxDQUFDLENBQUM7Z0JBQ2xDLFNBQVMsR0FBRyxDQUFDLENBQUMsSUFBSSxhQUFhLElBQUksQ0FBQyxDQUFDOztnQkFHckMsU0FBUyxHQUFHLElBQUksQ0FBQztnQkFDakIsU0FBUzthQUNWO2lCQUFNLElBQUksSUFBSSxLQUFLLFFBQVEsRUFBRTtnQkFDNUIsTUFBTTthQUNQOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O1lBcUJELElBQUksVUFBVSxHQUFHLElBQUksR0FBRyxTQUFTLEdBQUcsSUFBSSxHQUFHLFNBQVMsQ0FBQzs7WUFHckQsSUFBSSxZQUFZLEdBQUcsQ0FBQyxDQUFDO1lBQ3JCLElBQUksS0FBSyxHQUFHLFVBQVUsQ0FBQztZQUN2QixPQUFPLEtBQUssR0FBRyxVQUFVLEVBQUU7Z0JBQ3pCLEtBQUssR0FBRyxVQUFVLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUMvQixFQUFFLFlBQVksQ0FBQzthQUNoQjtZQUVELElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQztZQUVkLElBQUksTUFBTSxHQUFHLEVBQUUsR0FBRyxZQUFZLElBQUksVUFBVSxLQUFLLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7WUFDL0QsSUFBSSxNQUFNLEdBQUcsYUFBYSxFQUFFO2dCQUMxQixPQUFPLENBQUMsR0FBRyxDQUFDLDJDQUEyQyxDQUFDLENBQUM7Z0JBQ3pELE9BQU87YUFDUjs7WUFHRCxNQUFNLENBQUMsRUFBRSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUM7WUFFakIsRUFBRSxJQUFJLFlBQVksQ0FBQztZQUNuQixJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7WUFFWCxJQUFJLFVBQVUsS0FBSyxJQUFJO2dCQUNyQixNQUFNLENBQUMsRUFBRSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUM7WUFFbkIsS0FBSyxHQUFHLFVBQVUsQ0FBQztZQUNuQixPQUFPLFlBQVksRUFBRSxFQUFFO2dCQUNyQixLQUFLLEdBQUcsVUFBVSxDQUFDLEtBQUssQ0FBQyxDQUFDO2dCQUMxQixNQUFNLENBQUMsRUFBRSxDQUFDLENBQUMsR0FBRyxLQUFLLEdBQUcsSUFBSSxDQUFDO2dCQUMzQixLQUFLLEtBQUssQ0FBQyxDQUFDO2FBQ2I7WUFFRCxJQUFJLFNBQVMsS0FBSyxJQUFJLElBQUksU0FBUyxHQUFHLElBQUksRUFBRTtnQkFDMUMsVUFBVSxDQUFDLFNBQVMsRUFBRSxDQUFDLEdBQUcsU0FBUyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7Ozs7OztnQkFNN0MsSUFBSSxTQUFTLElBQUksU0FBUyxHQUFHLENBQUMsSUFBSSxhQUFhLEdBQUcsRUFBRSxFQUFFO29CQUNwRCxFQUFFLGFBQWEsQ0FBQztvQkFDaEIsU0FBUyxHQUFHLFNBQVMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO2lCQUNoQzthQUNGO1lBRUQsU0FBUyxHQUFHLElBQUksQ0FBQztTQUNsQjtRQUVELElBQUksRUFBRSxLQUFLLGFBQWEsRUFBRTtZQUN4QixPQUFPLENBQUMsR0FBRyxDQUFDLDRDQUE0QyxDQUFDLENBQUM7U0FDM0Q7UUFFRCxPQUFPLE1BQU0sQ0FBQztJQUNoQixDQUFDOztJQ3JkRCxJQUFJLElBQUksR0FBRyxFQUFFLENBQUM7SUFFZCxJQUFJLFVBQVUsSUFBSSxDQUFDLFVBQVUsQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFO1FBQzNDLFVBQVUsQ0FBQyxTQUFTLENBQUMsS0FBSyxHQUFHO1lBQVUsYUFBTTtpQkFBTixVQUFNLEVBQU4scUJBQU0sRUFBTixJQUFNO2dCQUFOLHdCQUFNOzs7WUFDekMsT0FBTyxDQUFBLEtBQUEsSUFBSSxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsUUFBUSxXQUFJLEdBQUcsRUFBRTtTQUNoRCxDQUFDO0tBQ0w7QUFBQSxJQUNELENBQUMsVUFBVSxJQUFJLEVBQUVBLE9BQUk7UUFDakIsSUFBSSxDQUFDLE9BQU8sR0FBRyxVQUFVLEdBQUc7WUFDeEIsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDLEtBQUssRUFDYixDQUFDLEdBQUcsR0FBRyxDQUFDLE1BQU0sQ0FBQztZQUNuQixJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxJQUFJLElBQUk7Z0JBQUUsT0FBTyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUV6RixJQUFJLElBQUksR0FBRyxFQUFFLENBQUM7WUFDZCxJQUFJLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxJQUFJLElBQUk7Z0JBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQztZQUU5RCxJQUFJLEdBQUcsRUFBRSxLQUFLLEdBQUcsSUFBSSxVQUFVLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztZQUMzQyxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsR0FBRyxDQUFDLE1BQU0sQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7Z0JBQ3hDLElBQUksR0FBRyxHQUFHLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQ3hCLElBQUksRUFBRSxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxFQUNmLEVBQUUsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsRUFDZixFQUFFLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQ25CLEVBQUUsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQztnQkFDekIsSUFBSSxLQUFLLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxFQUFFLEVBQUUsRUFBRSxFQUFFLEdBQUcsQ0FBQyxDQUFDO2dCQUU1RCxJQUFJLENBQUMsSUFBSSxDQUFDO29CQUFFLEdBQUcsR0FBRyxLQUFLLENBQUM7cUJBQ25CLElBQUksR0FBRyxDQUFDLEtBQUssSUFBSSxDQUFDO29CQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxFQUFFLEVBQUUsR0FBRyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQztxQkFDeEUsSUFBSSxHQUFHLENBQUMsS0FBSyxJQUFJLENBQUM7b0JBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEVBQUUsRUFBRSxHQUFHLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDO2dCQUU3RSxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQztnQkFDdEIsR0FBRyxHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBRW5CLElBQUksR0FBRyxDQUFDLE9BQU8sSUFBSSxDQUFDLEVBQUUsQ0FBRTtxQkFBTSxJQUFJLEdBQUcsQ0FBQyxPQUFPLElBQUksQ0FBQztvQkFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsRUFBRSxFQUFFLEdBQUcsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUM7cUJBQ25HLElBQUksR0FBRyxDQUFDLE9BQU8sSUFBSSxDQUFDLEVBQUU7b0JBQ3ZCLElBQUksRUFBRSxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7b0JBQ2YsT0FBTyxHQUFHLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDLE9BQU8sSUFBSSxDQUFDO3dCQUFFLEVBQUUsRUFBRSxDQUFDO29CQUN6QyxHQUFHLEdBQUcsSUFBSSxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO2lCQUMzQzthQUNKO1lBQ0QsT0FBTyxJQUFJLENBQUM7U0FDZixDQUFBO1FBQ0QsSUFBSSxDQUFDLE9BQU8sQ0FBQyxXQUFXLEdBQUcsVUFBVSxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxHQUFHO1lBQ2hELElBQUksSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLEVBQ1osR0FBRyxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ25DLElBQUksR0FBRyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQztZQUNqQyxJQUFJLEVBQUUsR0FBRyxJQUFJLFVBQVUsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDLEVBQzdCLElBQUksR0FBRyxJQUFJLFdBQVcsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUM7WUFDdEMsSUFBSSxLQUFLLEdBQUcsR0FBRyxDQUFDLEtBQUssRUFDakIsS0FBSyxHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUM7WUFDdEIsSUFBSSxFQUFFLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUM7O1lBRzlCLElBQUksS0FBSyxJQUFJLENBQUMsRUFBRTtnQkFDWixJQUFJLEtBQUssR0FBRyxJQUFJLElBQUksQ0FBQyxDQUFDO2dCQUN0QixJQUFJLEtBQUssSUFBSSxDQUFDO29CQUNWLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLEVBQUUsQ0FBQyxFQUFFLEVBQUU7d0JBQzVCLEVBQUUsQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7O3FCQUVuQjtnQkFDTCxJQUFJLEtBQUssSUFBSSxFQUFFO29CQUNYLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLEVBQUUsQ0FBQyxFQUFFLEVBQUU7d0JBQzVCLEVBQUUsQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO3FCQUN4QjthQUNSO2lCQUFNLElBQUksS0FBSyxJQUFJLENBQUMsRUFBRTtnQkFDbkIsSUFBSSxFQUFFLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsRUFDckIsRUFBRSxHQUFHLENBQUMsQ0FBQyxFQUNQLEVBQUUsR0FBRyxDQUFDLENBQUMsRUFDUCxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUM7Z0JBQ1osSUFBSSxFQUFFLEVBQUU7b0JBQ0osRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztvQkFDWCxFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO29CQUNYLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7aUJBQ2Q7Z0JBQ0QsSUFBSSxLQUFLLElBQUksQ0FBQztvQkFDVixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsSUFBSSxFQUFFLENBQUMsRUFBRSxFQUFFO3dCQUMzQixJQUFJLEVBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUNYLEVBQUUsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO3dCQUNmLEVBQUUsQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7d0JBQ2xCLEVBQUUsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQzt3QkFDMUIsRUFBRSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO3dCQUMxQixFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLEdBQUcsQ0FBQzt3QkFDakIsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLEVBQUUsSUFBSSxJQUFJLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsSUFBSSxJQUFJLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUU7NEJBQUUsRUFBRSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUM7cUJBQzlGO2dCQUNMLElBQUksS0FBSyxJQUFJLEVBQUU7b0JBQ1gsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLElBQUksRUFBRSxDQUFDLEVBQUUsRUFBRTt3QkFDM0IsSUFBSSxFQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFDWCxFQUFFLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQzt3QkFDZixFQUFFLENBQUMsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO3dCQUNsQixFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUM7d0JBQzFCLEVBQUUsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQzt3QkFDMUIsRUFBRSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxHQUFHLENBQUM7d0JBQ2pCLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsQ0FBQyxJQUFJLEVBQUUsRUFBRSxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLENBQUMsSUFBSSxFQUFFLEVBQUUsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFOzRCQUFFLEVBQUUsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO3FCQUMxRzthQUNSO2lCQUFNLElBQUksS0FBSyxJQUFJLENBQUMsRUFBRTtnQkFDbkIsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsRUFDcEIsRUFBRSxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQ3JCLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUM7O2dCQUU1QixJQUFJLEtBQUssSUFBSSxDQUFDO29CQUNWLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUU7d0JBQ3hCLElBQUksRUFBRSxHQUFHLENBQUMsR0FBRyxHQUFHLEVBQ1osRUFBRSxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7d0JBQ2YsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRTs0QkFDeEIsSUFBSSxFQUFFLEdBQUcsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxLQUFLLENBQUMsRUFDbEIsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLEVBQ3ZELEVBQUUsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDOzRCQUNmLEVBQUUsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7NEJBQ2YsRUFBRSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDOzRCQUN2QixFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUM7NEJBQ3ZCLEVBQUUsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsR0FBRyxHQUFHLENBQUM7eUJBQ3ZDO3FCQUNKO2dCQUNMLElBQUksS0FBSyxJQUFJLENBQUM7b0JBQ1YsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRTt3QkFDeEIsSUFBSSxFQUFFLEdBQUcsQ0FBQyxHQUFHLEdBQUcsRUFDWixFQUFFLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQzt3QkFDZixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFOzRCQUN4QixJQUFJLEVBQUUsR0FBRyxDQUFDLEVBQUUsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUNsQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsRUFDdkQsRUFBRSxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7NEJBQ2YsRUFBRSxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQzs0QkFDZixFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUM7NEJBQ3ZCLEVBQUUsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQzs0QkFDdkIsRUFBRSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxHQUFHLEdBQUcsQ0FBQzt5QkFDdkM7cUJBQ0o7Z0JBQ0wsSUFBSSxLQUFLLElBQUksQ0FBQztvQkFDVixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFO3dCQUN4QixJQUFJLEVBQUUsR0FBRyxDQUFDLEdBQUcsR0FBRyxFQUNaLEVBQUUsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO3dCQUNmLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUU7NEJBQ3hCLElBQUksRUFBRSxHQUFHLENBQUMsRUFBRSxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQ2xCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxFQUN4RCxFQUFFLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQzs0QkFDZixFQUFFLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDOzRCQUNmLEVBQUUsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQzs0QkFDdkIsRUFBRSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDOzRCQUN2QixFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLEdBQUcsR0FBRyxDQUFDO3lCQUN2QztxQkFDSjtnQkFDTCxJQUFJLEtBQUssSUFBSSxDQUFDO29CQUNWLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUU7d0JBQzNCLElBQUksRUFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQ1gsQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDLENBQUMsRUFDWCxFQUFFLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQzt3QkFDZixFQUFFLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO3dCQUNmLEVBQUUsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQzt3QkFDdkIsRUFBRSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO3dCQUN2QixFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLEdBQUcsR0FBRyxDQUFDO3FCQUN2QzthQUNSO2lCQUFNLElBQUksS0FBSyxJQUFJLENBQUMsRUFBRTtnQkFDbkIsSUFBSSxLQUFLLElBQUksQ0FBQztvQkFDVixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsSUFBSSxFQUFFLENBQUMsRUFBRSxFQUFFO3dCQUMzQixJQUFJLEVBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUNYLEVBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUNYLEVBQUUsR0FBRyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7d0JBQ2xCLEVBQUUsQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUM7d0JBQ1osRUFBRSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUM7d0JBQ2hCLEVBQUUsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDO3dCQUNoQixFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUM7cUJBQzdCO2dCQUNMLElBQUksS0FBSyxJQUFJLEVBQUU7b0JBQ1gsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLElBQUksRUFBRSxDQUFDLEVBQUUsRUFBRTt3QkFDM0IsSUFBSSxFQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFDWCxFQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFDWCxFQUFFLEdBQUcsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO3dCQUNsQixFQUFFLENBQUMsRUFBRSxDQUFDLEdBQUcsRUFBRSxDQUFDO3dCQUNaLEVBQUUsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDO3dCQUNoQixFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQzt3QkFDaEIsRUFBRSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO3FCQUM3QjthQUNSO2lCQUFNLElBQUksS0FBSyxJQUFJLENBQUMsRUFBRTtnQkFDbkIsSUFBSSxFQUFFLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO2dCQUNsRCxJQUFJLEtBQUssSUFBSSxDQUFDO29CQUNWLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUU7d0JBQzNCLElBQUksRUFBRSxHQUFHLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxFQUNsRCxFQUFFLEdBQUcsQ0FBQyxFQUFFLElBQUksRUFBRSxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDO3dCQUNwQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDO3FCQUN0RDtnQkFDTCxJQUFJLEtBQUssSUFBSSxDQUFDO29CQUNWLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUU7d0JBQzNCLElBQUksRUFBRSxHQUFHLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxFQUN0RCxFQUFFLEdBQUcsQ0FBQyxFQUFFLElBQUksRUFBRSxHQUFHLEVBQUUsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDO3dCQUNuQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDO3FCQUN0RDtnQkFDTCxJQUFJLEtBQUssSUFBSSxDQUFDO29CQUNWLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUU7d0JBQzNCLElBQUksRUFBRSxHQUFHLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxFQUN2RCxFQUFFLEdBQUcsQ0FBQyxFQUFFLElBQUksRUFBRSxHQUFHLEVBQUUsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDO3dCQUNuQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDO3FCQUN0RDtnQkFDTCxJQUFJLEtBQUssSUFBSSxDQUFDO29CQUNWLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUU7d0JBQzNCLElBQUksRUFBRSxHQUFHLElBQUksQ0FBQyxDQUFDLENBQUMsRUFDWixFQUFFLEdBQUcsQ0FBQyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUM7d0JBQzlCLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUM7cUJBQ3REO2dCQUNMLElBQUksS0FBSyxJQUFJLEVBQUU7b0JBQ1gsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLElBQUksRUFBRSxDQUFDLEVBQUUsRUFBRTt3QkFDM0IsSUFBSSxFQUFFLEdBQUcsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFD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QUFFLEdBQUcsRUFBRSxFQUFFLEdBQUcsR0FBRyxDQUFDLENBQUM7b0JBQzlDLEdBQUcsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDO29CQUNiLEVBQUUsR0FBRyxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBQztvQkFDN0IsSUFBSSxLQUFLLEdBQUcsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsR0FBRyxFQUFFLEVBQUUsR0FBRyxHQUFHLENBQUMsQ0FBQztvQkFDOUMsR0FBRyxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUM7b0JBQ2IsSUFBSSxJQUFJLEdBQUcsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSSxHQUFHLEdBQUcsTUFBTSxDQUFDLENBQUMsQ0FBQztvQkFDekQsR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxJQUFJLENBQUM7aUJBQy9CO3FCQUFNLElBQUksSUFBSSxJQUFJLE1BQU0sRUFBRTtvQkFDdkIsR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsR0FBRyxDQUFDLENBQUM7aUJBQ3JEO3FCQUFNLElBQUksSUFBSSxJQUFJLE1BQU0sRUFBRTtvQkFDdkIsSUFBSSxFQUFFLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO29CQUNyQyxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztvQkFDcEIsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDLEVBQUU7d0JBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxNQUFNLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7aUJBQy9FO3FCQUFNLElBQUksSUFBSSxJQUFJLE1BQU0sRUFBRTtvQkFDdkIsSUFBSSxHQUFHLENBQUMsS0FBSyxJQUFJLENBQUM7d0JBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsR0FBRyxDQUFDLENBQUM7eUJBQ2pFLElBQUksR0FBRyxDQUFDLEtBQUssSUFBSSxDQUFDO3dCQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQzt5QkFDdkQsSUFBSSxHQUFHLENBQUMsS0FBSyxJQUFJLENBQUM7d0JBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLEVBQUUsR0FBRyxDQUFDLElBQUksRUFBRSxNQUFNLEdBQUcsQ0FBQyxDQUFDLEVBQUUsR0FBRyxDQUFDLElBQUksRUFBRSxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQzs7aUJBRS9HO3FCQUFNLElBQUksSUFBSSxJQUFJLE1BQU07b0JBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsR0FBRyxNQUFNLENBQUM7cUJBQzNFLElBQUksSUFBSSxJQUFJLE1BQU07b0JBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7cUJBQ2xELElBQUksSUFBSSxJQUFJLE1BQU0sRUFBRTtvQkFDckIsSUFBSSxHQUFHLENBQUMsS0FBSyxJQUFJLENBQUMsSUFBSSxHQUFHLENBQUMsS0FBSyxJQUFJLENBQUM7d0JBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsTUFBTSxD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O3dCQUNULEtBQUssSUFBSSxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxFQUFFOzRCQUFFLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxJQUFJLEdBQUcsQ0FBQztvQkFDdkUsSUFBSSxJQUFJLElBQUksQ0FBQzt3QkFDVCxLQUFLLElBQUksQ0FBQyxHQUFHLEdBQUcsRUFBRSxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsRUFBRTs0QkFBRSxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxHQUFHLENBQUM7b0JBQ2xHLElBQUksSUFBSSxJQUFJLENBQUM7d0JBQ1QsS0FBSyxJQUFJLENBQUMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxHQUFHLEdBQUcsRUFBRSxDQUFDLEVBQUU7NEJBQUUsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxHQUFHLENBQUM7aUJBQzNHO3FCQUFNO29CQUNILElBQUksSUFBSSxJQUFJLENBQUMsRUFBRTt3QkFDWCxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsRUFBRTs0QkFBRSxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHLENBQUMsSUFBSSxHQUFHLENBQUM7cUJBQ3hGO29CQUVELElBQUksSUFBSSxJQUFJLENBQUMsRUFBRTt3QkFDWCxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsRUFBRTs0QkFBRSxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxHQUFHLENBQUM7d0JBQzVGLEtBQUssSUFBSSxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxFQUFFOzRCQUFFLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksR0FBRyxDQUFDO3FCQUN2SDtvQkFFRCxJQUFJLElBQUksSUFBSSxDQUFDLEVBQUU7d0JBQ1gsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEdBQUcsRUFBRSxDQUFDLEVBQUU7NEJBQUUsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLEdBQUcsS0FBSyxDQUFDLENBQUMsRUFBRSxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxHQUFHLENBQUM7d0JBQ2xHLEtBQUssSUFBSSxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxFQUFFOzRCQUFFLElBQUksQ0FBQyxDQUFDLEdB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QUksQ0FBQyxFQUFFO3dCQUNYLEVBQUUsQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUM7d0JBQ2hCLEVBQUUsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQzt3QkFDeEIsRUFBRSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO3dCQUN4QixFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUM7cUJBQzNCO3lCQUFNLElBQUksSUFBSSxJQUFJLENBQUMsRUFBRTt3QkFDbEIsSUFBSSxFQUFFLEdBQUcsRUFBRSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDLEVBQzNCLEVBQUUsR0FBRyxFQUFFLENBQUMsRUFBRSxDQUFDLEdBQUcsRUFBRSxFQUNoQixFQUFFLEdBQUcsRUFBRSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLEVBQ3BCLEVBQUUsR0FBRyxFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQzt3QkFDekIsSUFBSSxFQUFFLEdBQUcsRUFBRSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDLEVBQzNCLEVBQUUsR0FBRyxFQUFFLENBQUMsRUFBRSxDQUFDLEdBQUcsRUFBRSxFQUNoQixFQUFFLEdBQUcsRUFBRSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLEVBQ3BCLEVBQUUsR0FBRyxFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQzt3QkFFekIsSUFBSSxHQUFHLEdBQUcsQ0FBQyxHQUFHLEVBQUUsRUFDWixFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxHQUFHLEVBQ2xC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LE1BQU0sRUFBRSxVQUFVOztZQUUvRCxJQUFJLFVBQVUsSUFBSSxJQUFJO2dCQUFFLFVBQVUsR0FBRyxLQUFLLENBQUM7WUFFM0MsSUFBSSxLQUFLLEdBQUcsQ0FBQyxFQUNULEtBQUssR0FBRyxDQUFDLEVBQ1QsUUFBUSxHQUFHLEdBQUcsQ0FBQTtZQUVsQixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtnQkFDbEMsSUFBSSxHQUFHLEdBQUcsSUFBSSxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQzdCLElBQUksR0FBRyxHQUFHLENBQUMsTUFBTSxDQUFDO2dCQUN0QixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsSUFBSSxFQUFFLENBQUMsSUFBSSxDQUFDO29CQUFFLFFBQVEsSUFBSSxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO2FBQzVEO1lBQ0QsSUFBSSxRQUFRLElBQUksUUFBUSxJQUFJLEdBQUcsQ0FBQyxDQUFDOztZQUdqQyxJQUFJLEtBQUssR0FBRyxRQUFRLElBQUksTUFBTSxDQUFDO1lBQy9CLElBQUksSUFBSSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRSxLQUFLLENBQUMsQ0FBQzs7WUFFMUQsSUFBSSxJQUFJLEdBQUcsRUFBRSxFQUNULElBQUksR0FBRyxFQUFFLEVBQ1QsSUFBSSxHQUFHLEVBQUUsQ0FBQztZQUVkLElBQUksRUFBRSxJQUFJLENBQUMsRUFBRTtnQkFDVCxJQUFJLEtBQUssR0FBRyxFQUFFLENBQUM7Z0JBQ2YsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFO29CQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFD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QUMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxFQUFFO3dCQUFFLElBQUksQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUM7Z0JBQ3RHLElBQUksSUFBSSxJQUFJLENBQUM7b0JBQ1QsS0FBSyxJQUFJLENBQUMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxHQUFHLEdBQUcsRUFBRSxDQUFDLEVBQUU7d0JBQUUsSUFBSSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUMsR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDO2FBQy9HO2lCQUFNO2dCQUNILElBQUksSUFBSSxJQUFJLENBQUMsRUFBRTtvQkFDWCxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsRUFBRTt3QkFBRSxJQUFJLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxHQUFHLEdBQUcsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDLElBQUksR0FBRyxDQUFDO2lCQUM1RjtnQkFDRCxJQUFJLElBQUksSUFBSSxDQUFDLEVBQUU7b0JBQ1gsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEdBQUcsRUFBRSxDQUFDLEVBQUU7d0JBQUUsSUFBSSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLEdBQUcsQ0FBQztvQkFDaEcsS0FBSyxJQUFJLENBQUMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxHQUFHLEdBQUcsRUFBRSxDQUFDLEVBQUU7d0JBQUUsSUFBSSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksR0FBRyxDQUFDO2lCQUMxSDtnQkFDRCxJQUFJLElBQUksSUFBSSxDQUFDLEVBQUU7b0JBQ1gsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEdBQUcsRUFBRSxDQUFDLEVBQUU7d0JBQUUsSUFBSSxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsR0FBRyxHQUFHLEtBQUssQ0FBQyxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFDLElBQUksR0FBRyxDQUFDO29CQUN0RyxLQUFLLElBQUksQ0FBQyxHQUFHLEdBQUcsRUFBRSxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsRUFBRTt3QkFBRSxJQUFJLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxHQUFHLEdBQUcsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxF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VUFBVSxJQUFJLEVBQUUsRUFBRSxFQUFFLEVBQUU7WUFDeEMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztZQUN6RCxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO1lBQ3JCLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDdkIsS0FBSyxJQUFJLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxFQUFFO2dCQUM3QixJQUFJLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUN2QixDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDLEVBQzNCLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUMsRUFDM0IsQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDOztnQkFFaEMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQztnQkFDVixDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUNWLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7Z0JBQ1YsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQztnQkFFVixDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDZCxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDZCxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDZCxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDZCxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDZCxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDZCxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDZCxDQUFDLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDZixDQUFDLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDZixDQUFDLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQzthQUNsQjtZQUNELENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDWixDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ1osQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNaLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDYixDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ2IsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQztZQUVkLE9BQU87Z0JBQ0gsQ0FBQyxFQUFFLENBQUM7Z0JBQ0osQ0FBQyxFQUFFLENBQUM7Z0JBQ0osQ0FBQyxFQUFFLENBQUM7YUFDUCxDQUFDO1NBQ0wsQ0FBQTtRQUNELElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxHQUFHLFVBQVUsS0FBSztZQUNsQyxJQUFJLENBQUMsR0FBRyxLQUFLLENBQUMsQ0FBQyxFQUNYLENBQUMsR0FBRyxLQUFLLENBQUMsQ0FBQyxFQUNYLENBQUMsR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDOztZQUdoQixJQUFJLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQ1QsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFDVCxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUNULEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQ1QsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztZQUM5QixJQUFJLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxFQUFFLENB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QUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQzthQUM3TztZQUNELEdBQUcsRUFBRSxVQUFVLENBQUMsRUFBRSxDQUFDO2dCQUNmLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMs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