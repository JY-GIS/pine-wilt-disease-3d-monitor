package com.songcai.controller;

import com.songcai.pojo.Result;
import com.songcai.pojo.User;
import com.songcai.service.UserService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@Slf4j
@RequestMapping("/users")
@RestController
public class UserController {

    @Autowired
    private UserService userService;

    @GetMapping   //查询所有调查员用户信息
    public Result list() {
        System.out.println("查询所有调查员用户信息:");
        List<User> user = userService.findAll();
        return Result.success(user);
    }

    @DeleteMapping //根据id删除用户信息
    public Result deleteById(String userId){
        System.out.println("删除的调查员信息的id是:" + userId);
        userService.deleteById(userId);
        return Result.success();
    }

    @PostMapping
    public Result addInfo(@RequestBody User user){
        System.out.println("新增的调查员信息是:" + user);
        userService.addInfor(user);
        return Result.success();
    }

    @GetMapping("/{userId}")
    public Result getInfo(@PathVariable String userId){
        System.out.println("查询用户的ID是:" + userId);
        List<User> user = userService.getInfo(userId);
        return Result.success(user);
    }

    @PutMapping("/{userId}/username")
    public Result updateName(@PathVariable String userId, @RequestBody Map<String,String> body){
        String newUsername = body.get("username");
        System.out.println("修改id为:" + userId + "的用户姓名:" + newUsername);
        userService.updateName(userId,newUsername);
        return Result.success();
    }

    @PostMapping("/{userId}/phone")
    public Result updatePhone(@PathVariable String userId, @RequestParam String phone) {
        userService.updatePhone(userId, phone);
        return Result.success();
    }


}
