Let Pixi.js support apng, gif images. And allow control of its operation.

[**Pixi-apngAndGif.js Use the demo**](http://jsbin.com/nodeto/edit?html,js,output)

# USE

### ES6

```bash
npm install pixi-apngandgif
```
```javascript
import PixiApngAndGif from 'pixi-apngandgif'

const app = new PIXI.Application();
const loader = PIXI.loader,
    loadOption = {
        loadType: PIXI.loaders.Resource.LOAD_TYPE.XHR,
        xhrType: PIXI.loaders.Resource.XHR_RESPONSE_TYPE.BUFFER,
        crossOrigin:''
    },
    imgs = {
        gif:'http://isparta.github.io/compare/image/dongtai/gif/1.gif',
        apng:'http://isparta.github.io/compare/image/dongtai/apng/1.png'
    };

loader.add(imgs.gif,loadOption);
loader.add(imgs.apng,loadOption);
loader.load((progress,resources)=>{
    window.gif = new PixiApngAndGif(imgs.gif,resources);
    window.apng = new PixiApngAndGif(imgs.apng,resources);

    let gifSprite = window.gif.sprite,
        apngSprite = window.apng.sprite;

    gifSprite.x = 100;
    apngSprite.x = 450;

    gifSprite.y = 160;
    apngSprite.y = 160;

    app.stage.addChild(gifSprite);
    app.stage.addChild(apngSprite);
});

document.body.appendChild(app.view);
```


### Browser

```html
<script src="https://cdn.staticfile.org/pixi.js/4.8.2/pixi.min.js"></script>
<script src="https://cdn.rawgit.com/sbfkcel/pixi-apngAndGif/master/dist/PixiApngAndGif.js"></script>
```

### Application code

```javascript
const app = new PIXI.Application();
const loader = PIXI.loader,
    loadOption = {
        loadType: PIXI.loaders.Resource.LOAD_TYPE.XHR,
        xhrType: PIXI.loaders.Resource.XHR_RESPONSE_TYPE.BUFFER,
        crossOrigin:''
    },
    imgs = {
        gif:'https://isparta.github.io/compare/image/dongtai/gif/1.gif',
        apng:'https://isparta.github.io/compare/image/dongtai/apng/1.png'
    };

loader.add(imgs.gif,loadOption);
loader.add(imgs.apng,loadOption);
loader.load((progress,resources)=>{
    window.gif = new PixiApngAndGif(imgs.gif,resources);
    window.apng = new PixiApngAndGif(imgs.apng,resources);

    let gifSprite = window.gif.sprite,
        apngSprite = window.apng.sprite;

    gifSprite.x = 100;
    apngSprite.x = 450;

    gifSprite.y = 160;
    apngSprite.y = 160;

    app.stage.addChild(gifSprite);
    app.stage.addChild(apngSprite);
});

document.body.appendChild(app.view);
```

## API

### `.play(bout,callback)`

Play animation
`bout`Used to specify the number of plays
`callback`Callback executed after the specified number of plays has been completed

### `.pause()`

Pause animation

### `.stop()`

Stop animation

### `.jumpToFrame(frame)`

Jump to the specified frame

### `.getDuration()`

Get the total duration of an animation single play

### `.getFramesLength()`

Get the number of animation frames

### `.on(status,callback)`

Used to invoke the specified method in the specified phase of the animation
`status`Four states(`playing`、`played`、`pause`、`stop`)
`callback`Callback, there is a parameter. The status of the current animation is recorded.