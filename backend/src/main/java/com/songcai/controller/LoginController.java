package com.songcai.controller;

import com.songcai.pojo.LoginInfo;
import com.songcai.pojo.Result;
import com.songcai.pojo.User;
import com.songcai.service.UserService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@Slf4j
@RestController
public class LoginController {

    @Autowired
    private UserService userService;

    @PostMapping("/login")
    public Result login(String username,String password){
        log.info("登录:{},{}",username,password);
        LoginInfo info = userService.login(username,password);
        if(info != null){
            return Result.success(info);
        }
        return Result.error("用户名或密码错误");
    }

}
