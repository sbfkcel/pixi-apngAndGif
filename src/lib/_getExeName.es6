export default (filePath)=>{
    let aList = filePath.split('.');
    return aList[aList.length - 1];
};