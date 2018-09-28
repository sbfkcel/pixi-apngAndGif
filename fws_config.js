module.exports = {
    "author": "FWS",
    "mail": "china1099@qq.com",
    "projectName": "pixi-apngAndGi",
    "template": "default",
    "createTime": 1538119743322,
    "distReplace": {
        "*": [
            {
                "find": "feutil.localstatic.com",
                "replace": "pic.my4399.com/re/cms/feUtil"
            },
            {
                "find": "$$localhost/staticfile",
                "replace": "pic.my4399.com/re/cms/feUtil"
            }
        ]
    },
    "srcSync": {
        "targetPath": "",
        "fileType": "*"
    },
    "devSync": {
        "targetPath": "",
        "fileType": "*"
    },
    "distSync": {
        "targetPath": "",
        "fileType": "*"
    }
};